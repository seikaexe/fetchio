FROM node:lts-slim

# yt-dlp = executable resmi (sudah membawa yt-dlp-ejs) dipasang di IMAGE, bukan disimpan di repository.
# ffmpeg dipakai untuk opsi audio MP3. Untuk memperbarui yt-dlp: docker build --no-cache
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl ffmpeg \
 && case "$(uname -m)" in aarch64|arm64) asset=yt-dlp_linux_aarch64 ;; *) asset=yt-dlp_linux ;; esac \
 && base=https://github.com/yt-dlp/yt-dlp/releases/latest/download \
 && curl -fsSL "$base/$asset" -o "/tmp/$asset" \
 && curl -fsSL "$base/SHA2-256SUMS" -o /tmp/SHA2-256SUMS \
 && (cd /tmp && grep " ${asset}\$" SHA2-256SUMS | sha256sum -c -) \
 && install -m 0755 "/tmp/$asset" /usr/local/bin/yt-dlp \
 && rm -f "/tmp/$asset" /tmp/SHA2-256SUMS \
 && yt-dlp --version \
 && apt-get purge -y --auto-remove curl \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
ENV PORT=3000 YTDLP_AUTO_DOWNLOAD=0
EXPOSE 3000
CMD ["npm", "start"]
