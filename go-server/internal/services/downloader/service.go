package downloader

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"os"
	"time"

	"github.com/gcottom/audiometa/v3"
	"github.com/gcottom/go-zaplog"
	"github.com/gcottom/yt-dl-4/config"
	"github.com/gcottom/yt-dl-4/internal"
	"go.uber.org/zap"
)

func (s *Service) InitiateDownload(ctx context.Context, id string) error {
	s.PutStatus(ctx, StatusUpdate{ID: id, Status: StatusQueued, Stage: 0})
	s.DownloadQueue <- id
	return nil
}

func (s *Service) GetStatus(ctx context.Context, id string) (*StatusUpdate, error) {
	data, ok := s.StatusMap.Load(id)
	if !ok {
		return nil, errors.New("status not found")
	}
	out, ok := data.(StatusUpdate)
	if !ok {
		return nil, errors.New("status not found")
	}
	return &out, nil
}

func (s *Service) PutStatus(ctx context.Context, status StatusUpdate) {
	zaplog.InfoC(ctx, "status update", zap.String("id", status.ID), zap.String("status", status.Status), zap.Int("stage", status.Stage))
	s.StatusMap.Store(status.ID, status)
}

func (s *Service) DownloadQueueProcessor() {
	for {
		select {
		case id := <-s.DownloadQueue:
			s.PutStatus(context.Background(), StatusUpdate{ID: id, Status: StatusQueued, Stage: 1})
			if internal.IsTrack(id) {
				go s.DownloadAndProcess(context.Background(), id)
			} else {
				go s.DownloadPlaylist(context.Background(), id)
			}
		default:
			time.Sleep(1 * time.Second)
		}
	}
}

func (s *Service) AcknowledgeWarning(ctx context.Context, id string) error {
	s.PutStatus(ctx, StatusUpdate{ID: id, Status: StatusWarningAck})
	return nil
}

func (s *Service) DownloadPlaylist(ctx context.Context, id string) error {
	playlistEntries, err := s.YTClient.GetPlaylistEntries(ctx, id)
	if err != nil {
		zaplog.ErrorC(ctx, "failed to get playlist entries", zap.String("id", id), zap.Error(err))
		s.PutStatus(ctx, StatusUpdate{ID: id, Status: StatusFailed, Stage: 2})
		return fmt.Errorf("failed to get playlist entries: %w", err)
	}
	if len(playlistEntries) > 10 {
		s.PutStatus(ctx, StatusUpdate{ID: id, Status: StatusWarning, Stage: 2, Warning: fmt.Sprintf("Playlist length is %d, downloading this many tracks may result in a ban. Are you sure you want to continue?", len(playlistEntries)), PlaylistTrackCount: len(playlistEntries)})
		ctxD, ctxCancelFunc := context.WithDeadline(ctx, time.Now().Add(10*time.Minute))
		defer ctxCancelFunc()
	outer:
		for {
			select {
			case <-ctxD.Done():
				s.PutStatus(ctx, StatusUpdate{ID: id, Status: StatusFailed, Stage: 2, Warning: "warning not acknowledged, abandoning download", PlaylistTrackCount: len(playlistEntries)})
				return fmt.Errorf("download playlist timed out")
			default:
				status, err := s.GetStatus(ctx, id)
				if err != nil {
					zaplog.ErrorC(ctx, "failed to get status", zap.String("id", id), zap.Error(err))
					s.PutStatus(ctx, StatusUpdate{ID: id, Status: StatusFailed, Stage: 2, PlaylistTrackCount: len(playlistEntries)})
					return fmt.Errorf("failed to get status: %w", err)
				}
				if status.Status == StatusWarningAck {
					break outer
				}
				time.Sleep(1 * time.Second)

			}
		}
	}
	s.PutStatus(ctx, StatusUpdate{ID: id, Status: StatusDownloading, Stage: 2, PlaylistTrackCount: len(playlistEntries)})
	for _, entry := range playlistEntries {
		s.InitiateDownload(ctx, entry)
	}
	outerErrCount := 0
outerfor:
	for {
		innerErrCount := 0
		doneCount := 0
		for _, entry := range playlistEntries {
			status, err := s.GetStatus(ctx, entry)
			if err != nil {
				zaplog.ErrorC(ctx, "failed to get status", zap.String("id", entry), zap.Error(err))
				innerErrCount++
				continue
			}
			if status.Status == StatusComplete || status.Status == StatusFailed {
				doneCount++
			} else if status.Status == StatusFailed {
				innerErrCount++
			}
		}
		s.PutStatus(ctx, StatusUpdate{ID: id, Status: StatusDownloading, Stage: 2, PlaylistTrackCount: len(playlistEntries), PlaylistTrackDone: doneCount})
		if doneCount == len(playlistEntries) {
			break outerfor
		}
		if innerErrCount > 0 {
			outerErrCount++
		}
		if innerErrCount > 5 {
			s.PutStatus(ctx, StatusUpdate{ID: id, Status: StatusFailed, Stage: 2, Warning: "too many errors, abandoning download"})
			return fmt.Errorf("too many errors")
		}
		if outerErrCount > 10 {
			s.PutStatus(ctx, StatusUpdate{ID: id, Status: StatusFailed, Stage: 2, Warning: "too many errors, abandoning download"})
			return fmt.Errorf("too many errors")
		}
		time.Sleep(5 * time.Second)
	}
	s.PutStatus(ctx, StatusUpdate{ID: id, Status: StatusComplete, Stage: 3, PlaylistTrackCount: len(playlistEntries), PlaylistTrackDone: len(playlistEntries)})
	return nil
}

func (s *Service) DownloadAndProcess(ctx context.Context, id string) error {
	data, err := s.DownloadFile(ctx, id)
	if err != nil {
		zaplog.ErrorC(ctx, "failed to download file", zap.String("id", id), zap.Error(err))
		s.PutStatus(ctx, StatusUpdate{ID: id, Status: StatusFailed, Stage: 2})
		return fmt.Errorf("failed to download file: %w", err)
	}
	defer s.Cleanup(ctx, id)
	if err = s.ConvertFile(ctx, id, data); err != nil {
		zaplog.ErrorC(ctx, "failed to convert file", zap.String("id", id), zap.Error(err))
		s.PutStatus(ctx, StatusUpdate{ID: id, Status: StatusFailed, Stage: 3})
		return fmt.Errorf("failed to convert file: %w", err)
	}
	data, err = s.GetMeta(ctx, id)
	if err != nil {
		zaplog.ErrorC(ctx, "failed to get meta", zap.String("id", id), zap.Error(err))
		s.PutStatus(ctx, StatusUpdate{ID: id, Status: StatusFailed, Stage: 4})
		return fmt.Errorf("failed to get meta: %w", err)
	}
	if err = s.SaveFile(ctx, id, data); err != nil {
		zaplog.ErrorC(ctx, "failed to save file", zap.String("id", id), zap.Error(err))
		s.PutStatus(ctx, StatusUpdate{ID: id, Status: StatusFailed, Stage: 5})
		return fmt.Errorf("failed to save file: %w", err)
	}
	s.PutStatus(ctx, StatusUpdate{ID: id, Status: StatusComplete, Stage: 6})
	return nil
}

func (s *Service) DownloadFile(ctx context.Context, id string) ([]byte, error) {
	s.DownloadLimiter.Acquire()
	s.PutStatus(ctx, StatusUpdate{ID: id, Status: StatusDownloading, Stage: 2})
	defer s.DownloadLimiter.Release()
	return s.YTClient.Download(ctx, id)
}

func (s *Service) ConvertFile(ctx context.Context, id string, data []byte) error {
	s.ConversionLimiter.Acquire()
	s.PutStatus(ctx, StatusUpdate{ID: id, Status: StatusProcessing, Stage: 3})
	defer s.ConversionLimiter.Release()
	convertedData, err := internal.ConvertFile(ctx, data)
	if err != nil {
		zaplog.ErrorC(ctx, "failed to convert file", zap.String("id", id), zap.Error(err))
		return fmt.Errorf("failed to convert file: %w", err)
	}
	if err = os.Mkdir(config.AppConfig.TempDir, 0755); err != nil && !os.IsExist(err) {
		zaplog.ErrorC(ctx, "failed to create temp dir", zap.Error(err))
		return fmt.Errorf("failed to create temp dir: %w", err)
	}
	savePath := fmt.Sprintf("%s/%s.%s", config.AppConfig.TempDir, id, internal.FILEFORMAT)
	if err = os.WriteFile(savePath, convertedData, 0644); err != nil {
		zaplog.ErrorC(ctx, "failed to write file", zap.String("id", id), zap.Error(err))
		return fmt.Errorf("failed to write file: %w", err)
	}
	return nil
}

func (s *Service) GetMeta(ctx context.Context, id string) ([]byte, error) {
	s.MetaLimiter.Acquire()
	s.PutStatus(ctx, StatusUpdate{ID: id, Status: StatusProcessing, Stage: 4})
	defer s.MetaLimiter.Release()
	return s.MetaServiceClient.AddMeta(ctx, id, fmt.Sprintf("%s/%s.%s", config.AppConfig.TempDir, id, internal.FILEFORMAT))
}

func (s *Service) SaveFile(ctx context.Context, id string, data []byte) error {
	s.PutStatus(ctx, StatusUpdate{ID: id, Status: StatusProcessing, Stage: 5})
	reader := bytes.NewReader(data)
	tag, err := audiometa.OpenTag(reader)
	if err != nil {
		zaplog.ErrorC(ctx, "failed to open tag", zap.String("id", id), zap.Error(err))
		return fmt.Errorf("failed to open tag: %w", err)
	}
	if err = os.Mkdir(config.AppConfig.SaveDir, 0755); err != nil && !os.IsExist(err) {
		zaplog.ErrorC(ctx, "failed to create save dir", zap.Error(err))
		return fmt.Errorf("failed to create save dir: %w", err)
	}
	savePath := fmt.Sprintf("%s/%s - %s.%s", config.AppConfig.SaveDir, tag.GetArtist(), tag.GetTitle(), internal.FILEFORMAT)
	savePath = internal.SanitizePath(savePath)
	if err = os.WriteFile(savePath, data, 0644); err != nil {
		zaplog.ErrorC(ctx, "failed to write file", zap.String("id", id), zap.Error(err))
		return fmt.Errorf("failed to write file: %w", err)
	}
	return nil
}

func (s *Service) Cleanup(ctx context.Context, id string) {
	_ = os.Remove(fmt.Sprintf("%s/%s", config.AppConfig.TempDir, id))
	_ = os.Remove(fmt.Sprintf("%s/%s.%s", config.AppConfig.TempDir, id, internal.FILEFORMAT))
}
