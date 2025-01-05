# Use the official Python 3.10 image
FROM golang:latest AS builder

ENV CGO_ENABLED=0

# Set the working directory inside the container
WORKDIR /app

# Copy go.mod and go.sum first
COPY ./go-server/go.mod ./go-server/go.sum ./

# Download Go dependencies
RUN go mod download

# Copy the Go source code
COPY ./go-server /app/go-server

WORKDIR /app/go-server/cmd

# Build the Go application
RUN go build -o go-server .

WORKDIR /app

# Use a lightweight FFmpeg image as the final base
FROM python:3.10.14
RUN apt-get update && apt-get install -y ffmpeg
# Set the working directory inside the container
WORKDIR /app

# Copy the built Go application from the builder stage
COPY --from=builder /app/go-server/cmd/go-server /app/go-server

# Copy Python files
COPY ./python /app/python

# Install Python dependencies
RUN pip3 install -r /app/python/genre-service/requirements.txt && \
    pip3 install -r /app/python/music-api/requirements.txt

# Set the entrypoint to run your Go application
ENTRYPOINT ["./go-server"]