package youtube

import (
	"net/http"

	"github.com/kkdai/youtube/v2"
)

type Client struct {
	YTClient *youtube.Client
}

func NewClient() *Client {
	return &Client{
		YTClient: &youtube.Client{HTTPClient: http.DefaultClient},
	}
}
