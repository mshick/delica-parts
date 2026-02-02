package image

import (
	"bytes"
	"encoding/base64"
	"fmt"
	"image/png"
	"os"
	"sync/atomic"

	"github.com/disintegration/imaging"
)

var imageIDCounter uint32

// KittyImage represents an image prepared for Kitty protocol rendering
type KittyImage struct {
	data   string // base64 encoded PNG
	width  int    // pixels
	height int    // pixels
	id     uint32
}

// LoadAndScale loads an image, scales it to fit within maxWidth x maxHeight cells,
// and prepares it for Kitty protocol rendering.
// Assumes ~10 pixels per cell width, ~20 pixels per cell height.
func LoadAndScale(path string, maxWidthCells, maxHeightCells int) (*KittyImage, error) {
	// Check file exists
	if _, err := os.Stat(path); os.IsNotExist(err) {
		return nil, fmt.Errorf("file not found: %s", path)
	}

	// Load image
	img, err := imaging.Open(path)
	if err != nil {
		return nil, fmt.Errorf("open image: %w", err)
	}

	// Convert cells to pixels (approximate)
	maxWidthPx := maxWidthCells * 10
	maxHeightPx := maxHeightCells * 20

	// Scale to fit
	bounds := img.Bounds()
	origWidth := bounds.Dx()
	origHeight := bounds.Dy()

	// Calculate scale factor
	scaleW := float64(maxWidthPx) / float64(origWidth)
	scaleH := float64(maxHeightPx) / float64(origHeight)
	scale := scaleW
	if scaleH < scaleW {
		scale = scaleH
	}

	newWidth := int(float64(origWidth) * scale)
	newHeight := int(float64(origHeight) * scale)

	// Resize
	resized := imaging.Resize(img, newWidth, newHeight, imaging.Lanczos)

	// Encode to PNG
	var buf bytes.Buffer
	if err := png.Encode(&buf, resized); err != nil {
		return nil, fmt.Errorf("encode png: %w", err)
	}

	// Base64 encode
	encoded := base64.StdEncoding.EncodeToString(buf.Bytes())

	id := atomic.AddUint32(&imageIDCounter, 1)

	return &KittyImage{
		data:   encoded,
		width:  newWidth,
		height: newHeight,
		id:     id,
	}, nil
}

// Render returns the escape sequence to display the image.
// The image is transmitted and displayed in one command.
// Note: Caller is responsible for cursor positioning if needed.
func (img *KittyImage) Render() string {
	// Kitty graphics protocol:
	// \x1b_G<key>=<value>,...;<payload>\x1b\\
	//
	// Keys:
	// a=T - transmit and display
	// f=100 - PNG format
	// t=d - direct transmission
	// i=<id> - image ID
	// s=<width> - width in pixels
	// v=<height> - height in pixels
	// q=2 - suppress responses

	// For large images, we need to chunk the data
	// Kitty protocol recommends chunks of 4096 bytes
	const chunkSize = 4096

	var result bytes.Buffer

	data := img.data
	first := true
	for len(data) > 0 {
		chunk := data
		more := 0
		if len(data) > chunkSize {
			chunk = data[:chunkSize]
			data = data[chunkSize:]
			more = 1
		} else {
			data = ""
		}

		result.WriteString("\x1b_G")
		if first {
			result.WriteString(fmt.Sprintf("a=T,f=100,t=d,i=%d,s=%d,v=%d,q=2,m=%d;",
				img.id, img.width, img.height, more))
			first = false
		} else {
			result.WriteString(fmt.Sprintf("m=%d;", more))
		}
		result.WriteString(chunk)
		result.WriteString("\x1b\\")
	}

	return result.String()
}

// Clear returns the escape sequence to delete an image by ID.
func Clear(id uint32) string {
	// a=d - delete
	// d=I - delete by ID
	// i=<id> - image ID
	return fmt.Sprintf("\x1b_Ga=d,d=I,i=%d,q=2\x1b\\", id)
}

// ClearAll returns the escape sequence to delete all images.
func ClearAll() string {
	return "\x1b_Ga=d,d=A,q=2\x1b\\"
}

// ID returns the image's unique identifier.
func (img *KittyImage) ID() uint32 {
	return img.id
}

// CellHeight estimates the height in terminal cells.
func (img *KittyImage) CellHeight() int {
	return (img.height + 19) / 20 // Round up
}

// CellWidth estimates the width in terminal cells.
func (img *KittyImage) CellWidth() int {
	return (img.width + 9) / 10 // Round up
}
