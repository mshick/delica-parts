.PHONY: help bootstrap migrate scrape status start build clean

help:
	@echo "Delica Parts"
	@echo ""
	@echo "Usage:"
	@echo "  make bootstrap    Fetch vehicle info and configure .env"
	@echo "  make migrate      Run database migrations"
	@echo "  make scrape       Start or resume scraping parts data"
	@echo "  make status       Show scraping progress"
	@echo "  make start        Launch the terminal user interface"
	@echo "  make build        Build the TUI binary"
	@echo "  make clean        Remove build artifacts"
	@echo ""
	@echo "First time setup:"
	@echo "  1. make bootstrap"
	@echo "  2. make scrape"
	@echo "  3. make start"

bootstrap:
	cd scraper && deno task bootstrap

migrate:
	cd scraper && deno task migrate

scrape:
	cd scraper && deno task scrape

status:
	cd scraper && deno task status

start: build
	./tui/delica-tui -data ./data

build:
	cd tui && go build -o delica-tui .

clean:
	rm -f tui/delica-tui
	rm -rf data/
