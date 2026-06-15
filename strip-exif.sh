#!/bin/bash
# Strips all EXIF metadata (GPS, device info, timestamps) from website images
# Run this before adding any new images to the site: npm run strip-exif

echo "Stripping EXIF metadata from all images..."
exiftool -all= -overwrite_original ./images/
echo "Done. All images are now privacy-safe."
