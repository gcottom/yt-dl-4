package handlers

import (
	"errors"

	"github.com/gcottom/go-zaplog"
	"github.com/gcottom/yt-dl-4/internal/services/downloader"
	"github.com/gin-gonic/gin"
	"go.uber.org/zap"
)

type Handlers struct {
	Downloader *downloader.Service
}

func SetupRoutes(router *gin.Engine, downloaderService *downloader.Service) {
	handler := &Handlers{Downloader: downloaderService}
	router.GET("/download", handler.StartDownload)
	router.GET("/status", handler.GetStatus)
	router.GET("/acknowledge", handler.AcknowledgeWarning)
}

func (h *Handlers) StartDownload(ctx *gin.Context) {
	id := ctx.Query("id")
	if id == "" {
		zaplog.WarnC(ctx, "start download request without ID present: ID is required")
		ResponseFailure(ctx, errors.New("start download request without ID present: ID is required"))
		return
	}
	zaplog.InfoC(ctx, "start download request received", zap.String("id", id))
	if err := h.Downloader.InitiateDownload(ctx, id); err != nil {
		zaplog.ErrorC(ctx, "error starting download", zap.Error(err))
		ResponseFailure(ctx, err)
		return
	}
	zaplog.InfoC(ctx, "start download request queued successfully", zap.String("id", id))
	ResponseSuccess(ctx, StartDownloadResponse{State: "ACK"})
}

func (h *Handlers) GetStatus(ctx *gin.Context) {
	id := ctx.Query("id")
	if id == "" {
		zaplog.WarnC(ctx, "get status request without ID present: ID is required")
		ResponseFailure(ctx, errors.New("get status request without ID present: ID is required"))
		return
	}
	zaplog.InfoC(ctx, "getting status request received", zap.String("id", id))
	status, err := h.Downloader.GetStatus(ctx, id)
	if err != nil {
		zaplog.ErrorC(ctx, "error getting status request", zap.Error(err))
		ResponseFailure(ctx, err)
		return
	}
	if status == nil {
		zaplog.WarnC(ctx, "status not yet available", zap.String("id", id))
		ResponseSuccess(ctx, StatusUpdate{ID: id, Status: "queued"})
		return
	}
	zaplog.InfoC(ctx, "get status request successful", zap.String("id", id))
	ResponseSuccess(ctx, *status)
}

func (h *Handlers) AcknowledgeWarning(ctx *gin.Context) {
	id := ctx.Query("id")
	if id == "" {
		zaplog.WarnC(ctx, "acknowledge warning request without ID present: ID is required")
		ResponseFailure(ctx, errors.New("acknowledge warning request without ID present: ID is required"))
		return
	}
	zaplog.InfoC(ctx, "acknowledge warning request received", zap.String("id", id))
	h.Downloader.AcknowledgeWarning(ctx, id)
	ResponseSuccess(ctx, StartDownloadResponse{State: "ACK"})
}
