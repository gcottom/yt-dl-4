package youtube

import (
	"context"
	"fmt"
	"io"

	"github.com/gcottom/go-zaplog"
	"github.com/kkdai/youtube/v2"
	"go.uber.org/zap"
)

func (s *Client) Download(ctx context.Context, id string) ([]byte, error) {
	zaplog.InfoC(ctx, "fetching video info", zap.String("id", id))
	var videoInfo *youtube.Video
	var err error
	videoInfo, err = s.YTClient.GetVideoContext(ctx, id)
	if err != nil {
		zaplog.ErrorC(ctx, "failed to get video info", zap.String("id", id), zap.Error(err))
		return nil, fmt.Errorf("failed to get video info: %w", err)
	}
	zaplog.InfoC(ctx, "video info fetched", zap.String("id", id))
	zaplog.InfoC(ctx, "getting best audio format", zap.String("id", id))
	bestFormat := getBestAudioFormat(videoInfo.Formats.Type("audio"))
	if bestFormat == nil {
		zaplog.ErrorC(ctx, "failed to get best audio format", zap.String("id", id))
		return nil, fmt.Errorf("failed to get best audio format")
	}
	zaplog.InfoC(ctx, "best audio format found", zap.String("id", id), zap.Int("bitrate", bestFormat.Bitrate))

	zaplog.InfoC(ctx, "downloading youtube stream", zap.String("id", id))
	var stream io.ReadCloser
	stream, _, err = s.YTClient.GetStreamContext(ctx, videoInfo, bestFormat)
	if err != nil {
		zaplog.ErrorC(ctx, "failed to get stream", zap.String("id", id), zap.Error(err))
		return nil, fmt.Errorf("failed to get stream: %w", err)
	}
	defer stream.Close()
	streamBytes, err := io.ReadAll(stream)
	if err != nil {
		zaplog.ErrorC(ctx, "failed to read stream", zap.String("id", id), zap.Error(err))
		return nil, fmt.Errorf("failed to read stream: %w", err)
	}
	zaplog.InfoC(ctx, "successfully downloaded youtube stream", zap.String("id", id))
	return streamBytes, nil
}

func (s *Client) GetPlaylistEntries(ctx context.Context, playlistID string) ([]string, error) {
	zaplog.InfoC(ctx, "getting playlist entries", zap.String("playlistID", playlistID))
	playlist, err := s.YTClient.GetPlaylist(playlistID)
	if err != nil {
		zaplog.ErrorC(ctx, "failed to get playlist entries", zap.String("playlistID", playlistID), zap.Error(err))
		return nil, err
	}
	entries := make([]string, 0)
	for _, entry := range playlist.Videos {
		entries = append(entries, entry.ID)
	}
	zaplog.InfoC(ctx, "successfully retrieved playlist entries", zap.String("playlistID", playlistID), zap.Int("count", len(entries)))
	return entries, nil
}

// GetVideoInfo returns the title and author of a video
func (s *Client) GetVideoInfo(ctx context.Context, videoID string) (string, string, error) {
	zaplog.InfoC(ctx, "getting video info", zap.String("videoID", videoID))
	var video *youtube.Video
	var err error
	video, err = s.YTClient.GetVideoContext(ctx, videoID)
	if err != nil {
		zaplog.ErrorC(ctx, "failed to get video info", zap.String("videoID", videoID), zap.Error(err))
		return "", "", fmt.Errorf("failed to get video info: %w", err)
	}
	zaplog.InfoC(ctx, "successfully retrieved video info", zap.String("videoID", videoID))
	return video.Title, video.Author, nil
}

func getBestAudioFormat(formats youtube.FormatList) *youtube.Format {
	var bestFormat *youtube.Format
	maxBitrate := 0
	for _, format := range formats {
		if format.Bitrate > maxBitrate {
			best := format
			bestFormat = &best
			maxBitrate = format.Bitrate
		}
	}
	return bestFormat
}
