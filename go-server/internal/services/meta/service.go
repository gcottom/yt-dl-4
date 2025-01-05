package meta

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"image"
	"net/http"
	"os"
	"regexp"
	"strings"

	"github.com/gcottom/audiometa/v3"
	"github.com/gcottom/go-zaplog"
	"github.com/gcottom/retry"
	"github.com/gcottom/yt-dl-4/internal"
	"github.com/zmb3/spotify/v2"
	spotifyauth "github.com/zmb3/spotify/v2/auth"
	"go.uber.org/zap"
	"golang.org/x/oauth2"
)

type GenreResponse struct {
	Genre string `json:"genre"`
}

func (s *Service) AddMeta(ctx context.Context, id string, filepath string) ([]byte, error) {
	trackMeta, err := s.GetBestMeta(ctx, id)
	if err != nil {
		zaplog.ErrorC(ctx, "failed to get best meta", zap.Error(err))
		return nil, err
	}
	zaplog.InfoC(ctx, "starting meta genre enrichment", zap.String("id", id))
	res, err := internal.OSExecuteFindJSONStart(ctx, "python", "./python/genre-service/genre-service.py", filepath)
	if err != nil {
		zaplog.ErrorC(ctx, "failed to add meta", zap.Error(err))
	}
	var genreRes GenreResponse
	if err = json.Unmarshal(res, &genreRes); err != nil {
		zaplog.ErrorC(ctx, "failed to unmarshal genre response", zap.Error(err))
	}
	trackMeta.Genre = genreRes.Genre
	out := new(bytes.Buffer)

	f, err := os.Open(filepath)
	if err != nil {
		zaplog.ErrorC(ctx, "failed to open file", zap.Error(err))
		return nil, err
	}
	defer f.Close()
	tag, err := audiometa.OpenTag(f)
	if err != nil {
		zaplog.ErrorC(ctx, "failed to open tag", zap.Error(err))
		return nil, err
	}
	tag.SetAlbum(trackMeta.Album)
	tag.SetArtist(trackMeta.Artist)
	tag.SetTitle(trackMeta.Title)
	tag.SetGenre(trackMeta.Genre)
	if trackMeta.CoverArtURL != "" {
		response, err := http.Get(trackMeta.CoverArtURL)
		if err != nil {
			zaplog.ErrorC(ctx, "failed to get cover art", zap.Error(err))
			return nil, err
		}
		defer response.Body.Close()
		img, _, err := image.Decode(response.Body)
		if err != nil {
			zaplog.ErrorC(ctx, "failed to decode cover art", zap.Error(err))
			return nil, err
		}
		tag.SetCoverArt(&img)
	}
	if err = tag.Save(out); err != nil {
		zaplog.ErrorC(ctx, "failed to save tag", zap.Error(err))
		return nil, err
	}
	return out.Bytes(), nil
}

func (s *Service) GetBestMeta(ctx context.Context, id string) (*TrackMeta, error) {
	res, err := retry.Retry(retry.NewAlgSimpleDefault(), 3, s.GetYTMetaFromID, ctx, id)
	if err != nil {
		zaplog.ErrorC(ctx, "failed to get yt meta", zap.Error(err))
		return nil, err
	}
	trackMeta := res[0].(TrackMeta)
	res, err = retry.Retry(retry.NewAlgSimpleDefault(), 3, s.GetSpotifyMeta, ctx, trackMeta)
	if err != nil {
		zaplog.ErrorC(ctx, "failed to get spotify meta", zap.Error(err))
		return nil, err
	}
	spotifyMetas := res[0].([]TrackMeta)
	bestMeta := s.GetBestMetaMatch(ctx, trackMeta, spotifyMetas)
	return &bestMeta, nil
}

func (s *Service) GetYTMetaFromID(ctx context.Context, id string) (TrackMeta, error) {
	zaplog.InfoC(ctx, "getting meta via yt api", zap.String("id", id))
	res, err := internal.OSExecuteFindJSONStart(ctx, "python", "./python/music-api/music-api.py", "meta", id)
	if err != nil {
		zaplog.ErrorC(ctx, "failed to get yt meta", zap.Error(err))
		return TrackMeta{}, err
	}
	var meta YTMMetaResponse
	if err = json.Unmarshal(res, &meta); err != nil {
		zaplog.ErrorC(ctx, "failed to unmarshal meta response", zap.Error(err))
		return TrackMeta{}, err
	}
	outmeta := TrackMeta{Artist: meta.Author, Title: meta.Title, CoverArtURL: meta.Image}
	return outmeta, nil
}

func (s *Service) GetSpotifyMeta(ctx context.Context, trackMeta TrackMeta) ([]TrackMeta, error) {
	searchTerm := fmt.Sprintf("track:%s artist:%s", trackMeta.Title, trackMeta.Artist)
	zaplog.InfoC(ctx, "searching spotify", zap.String("searchTerm", searchTerm))

	token, err := s.GetSpotifyToken(ctx)
	if err != nil {
		zaplog.ErrorC(ctx, "failed to get spotify token", zap.Error(err))
		return nil, err
	}

	authClient := spotifyauth.New().Client(ctx, token)
	spotifyClient := spotify.New(authClient)

	res, err := spotifyClient.Search(ctx, searchTerm, spotify.SearchTypeTrack)
	if err != nil {
		zaplog.ErrorC(ctx, "failed to search spotify", zap.Error(err))
		return nil, err
	}

	trackMetas := make([]TrackMeta, 0)
	for _, track := range res.Tracks.Tracks {
		resMeta := TrackMeta{}
		if len(track.Album.Images) > 0 {
			resMeta.CoverArtURL = track.Album.Images[0].URL
		}

		artists := make([]string, 0)
		for _, artist := range track.Artists {
			artists = append(artists, artist.Name)
		}

		resMeta.Artist = strings.Join(artists, ", ")
		resMeta.Album = track.Album.Name
		resMeta.Title = track.Name
		trackMetas = append(trackMetas, resMeta)
	}

	zaplog.InfoC(ctx, "spotify search results", zap.Any("results", trackMetas))
	return trackMetas, nil
}

func (s *Service) GetSpotifyToken(ctx context.Context) (*oauth2.Token, error) {
	token, err := s.SpotifyConfig.Token(ctx)
	if err != nil {
		zaplog.ErrorC(ctx, "failed to get spotify token", zap.Error(err))
		return nil, err
	}
	return token, nil
}

func (s *Service) GetBestMetaMatch(ctx context.Context, trackMeta TrackMeta, spotifyMetas []TrackMeta) TrackMeta {
	coverArtist := s.CoverArtistCheck(ctx, trackMeta.Title)
	if coverArtist != "" {
		zaplog.InfoC(ctx, "cover artist found", zap.String("coverArtist", coverArtist))
	}
	sanitizedTitle := s.SanitizeString(s.SanitizeParenthesis(trackMeta.Title))
	zaplog.InfoC(ctx, "sanitized title", zap.String("title", sanitizedTitle))
	featStrippedTitle := strings.Split(sanitizedTitle, "feat")[0]
	zaplog.InfoC(ctx, "feat stripped title", zap.String("title", featStrippedTitle))
	titles := []string{trackMeta.Title, sanitizedTitle, featStrippedTitle}
	artists := []string{trackMeta.Artist}
	if coverArtist != "" {
		artists = append(artists, s.SanitizeAuthor(coverArtist))
	}
	if len(spotifyMetas) == 0 {
		spotifyMetas, err := s.GetSpotifyMeta(ctx, TrackMeta{Title: sanitizedTitle, Artist: trackMeta.Artist})
		if err != nil {
			zaplog.ErrorC(ctx, "failed to get spotify meta", zap.Error(err))
			return TrackMeta{Title: sanitizedTitle, Artist: trackMeta.Artist, Album: sanitizedTitle, CoverArtURL: trackMeta.CoverArtURL}
		}
		if coverArtist != "" {
			caSpotifyMetas, err := s.GetSpotifyMeta(ctx, TrackMeta{Title: sanitizedTitle, Artist: coverArtist})
			if err != nil {
				zaplog.ErrorC(ctx, "failed to get spotify meta", zap.Error(err))
				return TrackMeta{Title: sanitizedTitle, Artist: trackMeta.Artist, Album: sanitizedTitle, CoverArtURL: trackMeta.CoverArtURL}
			}
			spotifyMetas = append(spotifyMetas, caSpotifyMetas...)
		}
		if len(spotifyMetas) == 0 {
			return TrackMeta{Title: sanitizedTitle, Artist: trackMeta.Artist, Album: sanitizedTitle, CoverArtURL: trackMeta.CoverArtURL}
		}
	}
	sanitizedSplits := strings.Split(strings.ReplaceAll(sanitizedTitle, ":", "-"), "-")
	if len(sanitizedSplits) < 2 {
		titles = append(titles, sanitizedSplits[0])
	}
	if len(sanitizedSplits) == 2 {
		titles = append(titles, sanitizedSplits[0], sanitizedSplits[1])
		artists = append(artists, s.SanitizeAuthor(sanitizedSplits[0]), s.SanitizeAuthor(sanitizedSplits[1]))
	} else if len(sanitizedSplits) == 3 {
		titles = append(titles, sanitizedSplits[0], sanitizedSplits[1], sanitizedSplits[2], fmt.Sprintf("%s %s", sanitizedSplits[0], sanitizedSplits[1]), fmt.Sprintf("%s %s", sanitizedSplits[1], sanitizedSplits[2]))
		artists = append(artists, s.SanitizeAuthor(sanitizedSplits[0]), s.SanitizeAuthor(sanitizedSplits[1]), s.SanitizeAuthor(sanitizedSplits[2]), s.SanitizeAuthor(fmt.Sprintf("%s %s", sanitizedSplits[0], sanitizedSplits[1])), s.SanitizeAuthor(fmt.Sprintf("%s %s", sanitizedSplits[1], sanitizedSplits[2])))
	} else if len(sanitizedSplits) == 4 {
		titles = append(titles, sanitizedSplits[0], sanitizedSplits[1], sanitizedSplits[2], sanitizedSplits[3], fmt.Sprintf("%s %s", sanitizedSplits[0], sanitizedSplits[1]), fmt.Sprintf("%s %s", sanitizedSplits[1], sanitizedSplits[2]), fmt.Sprintf("%s %s", sanitizedSplits[2], sanitizedSplits[3]), fmt.Sprintf("%s %s %s", sanitizedSplits[0], sanitizedSplits[1], sanitizedSplits[2]), fmt.Sprintf("%s %s %s", sanitizedSplits[1], sanitizedSplits[2], sanitizedSplits[3]), fmt.Sprintf("%s %s", sanitizedSplits[0], sanitizedSplits[1]))
		artists = append(artists, s.SanitizeAuthor(sanitizedSplits[0]), s.SanitizeAuthor(sanitizedSplits[1]), s.SanitizeAuthor(sanitizedSplits[2]), s.SanitizeAuthor(sanitizedSplits[3]), s.SanitizeAuthor(fmt.Sprintf("%s %s", sanitizedSplits[0], sanitizedSplits[1])), s.SanitizeAuthor(fmt.Sprintf("%s %s", sanitizedSplits[1], sanitizedSplits[2])), s.SanitizeAuthor(fmt.Sprintf("%s %s", sanitizedSplits[2], sanitizedSplits[3])), s.SanitizeAuthor(fmt.Sprintf("%s %s %s", sanitizedSplits[0], sanitizedSplits[1], sanitizedSplits[2])), s.SanitizeAuthor(fmt.Sprintf("%s %s %s", sanitizedSplits[1], sanitizedSplits[2], sanitizedSplits[3])), s.SanitizeAuthor(fmt.Sprintf("%s %s", sanitizedSplits[0], sanitizedSplits[1])))
	}
	featStrippedSplits := strings.Split(strings.ReplaceAll(featStrippedTitle, ":", "-"), "-")
	if len(featStrippedSplits) < 2 {
		titles = append(titles, featStrippedSplits[0])
	}
	if len(featStrippedSplits) == 2 {
		titles = append(titles, featStrippedSplits[0], featStrippedSplits[1])
		artists = append(artists, s.SanitizeAuthor(featStrippedSplits[0]), s.SanitizeAuthor(featStrippedSplits[1]))
	} else if len(featStrippedSplits) == 3 {
		titles = append(titles, featStrippedSplits[0], featStrippedSplits[1], featStrippedSplits[2], fmt.Sprintf("%s %s", featStrippedSplits[0], featStrippedSplits[1]), fmt.Sprintf("%s %s", featStrippedSplits[1], featStrippedSplits[2]))
		artists = append(artists, s.SanitizeAuthor(featStrippedSplits[0]), s.SanitizeAuthor(featStrippedSplits[1]), s.SanitizeAuthor(featStrippedSplits[2]), s.SanitizeAuthor(fmt.Sprintf("%s %s", featStrippedSplits[0], featStrippedSplits[1])), s.SanitizeAuthor(fmt.Sprintf("%s %s", featStrippedSplits[1], featStrippedSplits[2])))
	} else if len(featStrippedSplits) == 4 {
		titles = append(titles, featStrippedSplits[0], featStrippedSplits[1], featStrippedSplits[2], featStrippedSplits[3], fmt.Sprintf("%s %s", featStrippedSplits[0], featStrippedSplits[1]), fmt.Sprintf("%s %s", featStrippedSplits[1], featStrippedSplits[2]), fmt.Sprintf("%s %s", featStrippedSplits[2], featStrippedSplits[3]), fmt.Sprintf("%s %s %s", featStrippedSplits[0], featStrippedSplits[1], featStrippedSplits[2]), fmt.Sprintf("%s %s %s", featStrippedSplits[1], featStrippedSplits[2], featStrippedSplits[3]), fmt.Sprintf("%s %s", featStrippedSplits[0], featStrippedSplits[1]))
		artists = append(artists, s.SanitizeAuthor(featStrippedSplits[0]), s.SanitizeAuthor(featStrippedSplits[1]), s.SanitizeAuthor(featStrippedSplits[2]), s.SanitizeAuthor(featStrippedSplits[3]), s.SanitizeAuthor(fmt.Sprintf("%s %s", featStrippedSplits[0], featStrippedSplits[1])), s.SanitizeAuthor(fmt.Sprintf("%s %s", featStrippedSplits[1], featStrippedSplits[2])), s.SanitizeAuthor(fmt.Sprintf("%s %s", featStrippedSplits[2], featStrippedSplits[3])), s.SanitizeAuthor(fmt.Sprintf("%s %s %s", featStrippedSplits[0], featStrippedSplits[1], featStrippedSplits[2])), s.SanitizeAuthor(fmt.Sprintf("%s %s %s", featStrippedSplits[1], featStrippedSplits[2], featStrippedSplits[3])), s.SanitizeAuthor(fmt.Sprintf("%s %s", featStrippedSplits[0], featStrippedSplits[1])))
	}
	for i, title := range titles {
		titles[i] = strings.Trim(strings.ReplaceAll(title, "  ", " "), " ")
	}
	for i, artist := range artists {
		artists[i] = strings.Trim(strings.ReplaceAll(artist, "  ", " "), " ")
	}
	zaplog.InfoC(ctx, "titles", zap.Strings("titles", titles))
	zaplog.InfoC(ctx, "artists", zap.Strings("artists", artists))

	for _, spotifyMeta := range spotifyMetas {
		if coverArtist != "" {
			if s.EqualIgnoringWhitespace(coverArtist, spotifyMeta.Artist) {
				for _, title := range titles {
					if s.EqualIgnoringWhitespace(title, spotifyMeta.Title) {
						return TrackMeta{Title: spotifyMeta.Title, Artist: spotifyMeta.Artist, Album: spotifyMeta.Album, CoverArtURL: spotifyMeta.CoverArtURL}
					}
				}
			}
		}
		for _, title := range titles {
			if s.EqualIgnoringWhitespace(title, spotifyMeta.Title) {
				for _, artist := range artists {
					if s.EqualIgnoringWhitespace(artist, spotifyMeta.Artist) {
						return TrackMeta{Title: spotifyMeta.Title, Artist: spotifyMeta.Artist, Album: spotifyMeta.Album, CoverArtURL: spotifyMeta.CoverArtURL}
					}
				}
			}
		}
	}

	return TrackMeta{Title: sanitizedTitle, Artist: trackMeta.Artist, Album: sanitizedTitle, CoverArtURL: trackMeta.CoverArtURL}
}

func (s *Service) GetPlaylistEntries(ctx context.Context, playlistID string) ([]string, error) {
	res, err := internal.OSExecuteFindJSONStart(ctx, "python", "./python/music-api/music-api.py", "playlist", playlistID)
	if err != nil {
		zaplog.ErrorC(ctx, "failed to get playlist entries", zap.Error(err))
		return nil, err
	}
	var playlistEntries PlaylistResponse
	if err = json.Unmarshal(res, &playlistEntries); err != nil {
		zaplog.ErrorC(ctx, "failed to unmarshal playlist entries", zap.Error(err))
		return nil, err
	}
	return playlistEntries.Tracks, nil
}

func (s *Service) SanitizeString(str string) string {
	regex := regexp.MustCompile(`[^a-zA-Z0-9\s\:\-]`)
	return regex.ReplaceAllString(str, "")
}

func (s *Service) SanitizeParenthesis(str string) string {
	regex := regexp.MustCompile(`\([^\(\)]*\)|\[[^\[\]]*\]`)
	return regex.ReplaceAllString(str, "")
}

func (s *Service) EqualIgnoringWhitespace(s1, s2 string) bool {
	// Remove all whitespace from both strings
	regex := regexp.MustCompile(`\s+`)
	cleanS1 := regex.ReplaceAllString(s1, "")
	cleanS2 := regex.ReplaceAllString(s2, "")

	// Compare the cleaned strings
	return strings.EqualFold(cleanS1, cleanS2)
}

func (s *Service) CoverArtistCheck(ctx context.Context, str string) string {
	str = strings.ToLower(str)
	parenthesisReg := regexp.MustCompile(`\([^\(\)]*\)|\[[^\[\]]*\]`)
	inParenthesis := parenthesisReg.FindAllString(str, -1)
	if len(inParenthesis) > 0 {
		for _, inParenthesisStr := range inParenthesis {
			if strings.Contains(strings.Trim(inParenthesisStr, " "), "cover by") {
				return strings.Trim(strings.Replace(inParenthesisStr, "cover by", "", -1), " ")
			} else if strings.Contains(strings.Trim(inParenthesisStr, " "), "covered by") {
				return strings.Trim(strings.Replace(inParenthesisStr, "covered by", "", -1), " ")
			} else if strings.HasSuffix(strings.Trim(inParenthesisStr, " "), "cover") {
				return strings.Trim(strings.Replace(inParenthesisStr, "cover", "", -1), " ")
			}
		}
	}
	return ""
}

func (s *Service) SanitizeAuthor(author string) string {
	author = strings.ToLower(author)
	r := regexp.MustCompile(` - official|-official|official| - vevo|-vevo|vevo|@| - topic|-topic|topic`)
	author = r.ReplaceAllString(author, "")
	author = strings.Trim(author, " ")
	return author
}
