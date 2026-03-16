# Makefile for ladderjs

.PHONY: all build run clean

# Default target
all: build

# Build the project using Gulp
build: node_modules
	npx gulp build

# Run the project using a local server with npx
run: build
	npx serve dist

# Install dependencies if package.json has changed
node_modules: package.json
	npm install
	touch node_modules

# Remove build artifacts and generated files
clean:
	rm -rf dist temp
	rm -f src/js/GameVersion-gen.json \
	     src/assets/spritesheet-gen.png \
	     src/assets/spritesheet-gen.json \
	     src/js/SpriteSheet-gen.js
