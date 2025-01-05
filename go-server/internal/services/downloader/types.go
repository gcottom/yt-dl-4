package downloader

import (
	"sync"

	"github.com/gcottom/semaphore"
	"github.com/gcottom/yt-dl-4/internal/services/meta"
	"github.com/gcottom/yt-dl-4/pkg/youtube"
)

type Service struct {
	DownloadLimiter   *semaphore.Semaphore
	ConversionLimiter *semaphore.Semaphore
	MetaLimiter       *semaphore.Semaphore
	DownloadQueue     chan string
	StatusMap         *sync.Map
	YTClient          *youtube.Client
	MetaServiceClient *meta.Service
}

type StatusUpdate struct {
	ID                 string `json:"id"`
	Status             string `json:"status"`
	PlaylistTrackCount int    `json:"playlist_track_count,omitempty"`
	PlaylistTrackDone  int    `json:"playlist_track_done,omitempty"`
	Warning            string `json:"warning,omitempty"`
	TrackArtist        string `json:"track_artist,omitempty"`
	TrackTitle         string `json:"track_title,omitempty"`
	Stage              int    `json:"stage,omitempty"`
}

type ProcessingStatus struct {
	ID       string `json:"id"`
	Status   string `json:"status"`
	FileURL  string `json:"url"`
	FileName string `json:"file_name"`
}

const (
	StatusQueued      = "queued"
	StatusDownloading = "downloading"
	StatusProcessing  = "processing"
	StatusComplete    = "complete"
	StatusFailed      = "failed"
	StatusWarning     = "warning"
	StatusWarningAck  = "warning_ack"
)
