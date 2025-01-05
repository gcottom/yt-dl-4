package internal

import (
	"bytes"
	"context"
	"fmt"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"

	"github.com/gcottom/go-zaplog"
	"go.uber.org/zap"
)

func ConvertFile(ctx context.Context, b []byte) ([]byte, error) {
	var args = []string{"-i", "pipe:0", "-c:a", "libmp3lame", "-b:a", "256k", "-f", "mp3", "-"}
	cmd := exec.Command("ffmpeg", args...)
	resultBuffer := bytes.NewBuffer(make([]byte, 0)) // pre allocate 5MiB buffer

	cmd.Stdout = resultBuffer // stdout result will be written here

	stdin, err := cmd.StdinPipe() // Open stdin pipe
	if err != nil {
		zaplog.ErrorC(ctx, "conversion error", zap.Error(err))
		return nil, err
	}

	err = cmd.Start() // Start a process on another goroutine
	if err != nil {
		zaplog.ErrorC(ctx, "conversion error", zap.Error(err))
		return nil, err
	}

	_, err = stdin.Write(b) // pump audio data to stdin pipe
	if err != nil {
		zaplog.ErrorC(ctx, "conversion error", zap.Error(err))
		return nil, err
	}
	err = stdin.Close() // close the stdin, or ffmpeg will wait forever
	if err != nil {
		zaplog.ErrorC(ctx, "conversion error", zap.Error(err))
		return nil, err
	}
	err = cmd.Wait() // wait until ffmpeg finish
	if err != nil {
		zaplog.ErrorC(ctx, "conversion error", zap.Error(err))
		return nil, err
	}
	return resultBuffer.Bytes(), nil
}

func OSExecuteFindJSONStart(ctx context.Context, command string, args ...string) ([]byte, error) {
	cmd := exec.Command(command, args...)
	var out bytes.Buffer
	cmd.Stdout = &out
	err := cmd.Run()
	if err != nil {
		zaplog.ErrorC(ctx, "failed to execute command", zap.Error(err))
		return nil, err
	}
	i := bytes.LastIndex(out.Bytes(), []byte("{"))
	return out.Bytes()[i:], nil
}

func SanitizePath(path string) string {
	invalidChars := regexp.MustCompile(`[<>:"/\\|?*\x00-\x1F]`)
	components := strings.Split(filepath.ToSlash(path), "/")
	for i, component := range components {
		if component == "" {
			continue
		}
		safeComponent := invalidChars.ReplaceAllString(component, "_")
		safeComponent = strings.Trim(safeComponent, " .")
		const maxLength = 255
		if len(safeComponent) > maxLength {
			safeComponent = safeComponent[:maxLength]
		}
		components[i] = safeComponent
	}
	sanitizedPath := filepath.Join(components...)
	sanitizedPath = strings.Replace(sanitizedPath, fmt.Sprintf(" .%s", FILEFORMAT), fmt.Sprintf(".%s", FILEFORMAT), -1)
	return sanitizedPath
}

func IsTrack(id string) bool {
	return len(id) == 11
}
