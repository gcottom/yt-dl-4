package main

import (
	"context"
	"net/http"
	"sync"
	"time"

	"github.com/fatih/color"
	"github.com/gcottom/go-zaplog"
	"github.com/gcottom/qgin/qgin"
	"github.com/gcottom/semaphore"
	"github.com/gcottom/yt-dl-4/config"
	"github.com/gcottom/yt-dl-4/internal/handlers"
	"github.com/gcottom/yt-dl-4/internal/services/downloader"
	"github.com/gcottom/yt-dl-4/internal/services/meta"
	"github.com/gcottom/yt-dl-4/pkg/youtube"
	"github.com/gin-contrib/cors"
	spotifyauth "github.com/zmb3/spotify/v2/auth"
	"go.uber.org/zap"
	"golang.org/x/oauth2/clientcredentials"
)

func init() {
	c := color.New(color.FgCyan)
	c.Print(`
:::   ::: :::::::::::               :::::::::  :::                          :::::   
:+:   :+:     :+:                   :+:    :+: :+:                         :+:+:+   
 +:+ +:+      +:+                   +:+    +:+ +:+                        +:+ +:+   
  +#++:       +#+     +#++:++#+     +#+    +:+ +#+        +#++:++#+      +#+  +:+   
   +#+        +#+                   +#+    +#+ +#+                      +#+#+#+#+#+ 
   #+#        #+#                   #+#    #+# #+#                            #+#   
   ###        ###                   #########  ##########                     ###   
|------------------------------------------------------------------------------------|
|                YouTube Music Integrated Download Service Client v4.0.0             |
|------------------------------------------------------------------------------------|
   `)
}

func main() {
	if err := RunServer(); err != nil {
		panic(err)
	}
}

func RunServer() error {
	ctx := zaplog.CreateAndInject(context.Background())
	zaplog.InfoC(ctx, "starting downloader server...")

	cfg, err := config.LoadConfigFromFile("")
	if err != nil {
		zaplog.ErrorC(ctx, "failed to load config", zap.Error(err))
		return err
	}

	zaplog.InfoC(ctx, "creating meta service...")
	metaService := &meta.Service{SpotifyConfig: &clientcredentials.Config{
		ClientID:     cfg.SpotifyClientID,
		ClientSecret: cfg.SpotifyClientSecret,
		TokenURL:     spotifyauth.TokenURL,
	}}

	zaplog.InfoC(ctx, "creating downloader service...")
	downloaderService := &downloader.Service{
		DownloadLimiter:   semaphore.NewSemaphore(2),
		ConversionLimiter: semaphore.NewSemaphore(2),
		MetaLimiter:       semaphore.NewSemaphore(2),
		DownloadQueue:     make(chan string, 100),
		StatusMap:         new(sync.Map),
		YTClient:          youtube.NewClient(),
		MetaServiceClient: metaService,
	}

	zaplog.InfoC(ctx, "creating gin engine...")
	ginws := qgin.NewGinEngine(&ctx, &qgin.Config{
		UseContextMW:       true,
		UseLoggingMW:       true,
		UseRequestIDMW:     false,
		InjectRequestIDCTX: false,
		LogRequestID:       false,
		ProdMode:           true,
	})
	ginws.Use(cors.New(cors.Config{
		AllowAllOrigins:  true,
		AllowMethods:     []string{"GET", "OPTIONS"},
		AllowHeaders:     []string{"Origin", "Content-Length", "Content-Type", "Accept"},
		ExposeHeaders:    []string{"Content-Length"},
		AllowCredentials: true,
		MaxAge:           12 * time.Hour,
	}))

	zaplog.InfoC(ctx, "setting up routes...")
	handlers.SetupRoutes(ginws, downloaderService)

	zaplog.InfoC(ctx, "starting download queue processor...")
	go downloaderService.DownloadQueueProcessor()

	zaplog.InfoC(ctx, "setup complete, starting server...")
	zaplog.InfoC(ctx, "now listening and serving on port 50999!")
	return http.ListenAndServe(":50999", ginws)
}
