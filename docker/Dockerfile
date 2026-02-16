# Stage: Install NPM packages
FROM node:24-bookworm-slim AS npm_dependencies

WORKDIR /server
COPY package*.json ./
RUN npm ci --omit=dev

# Stage: Runtime
FROM node:24-bookworm-slim

ENV IMAGEMAGICK_VERSION="7.1.2-13"

# Dependencies for ImageMagick
RUN apt update -y \
 && apt install -y --no-install-recommends \
    ffmpeg \
    libpng-dev \
    libjpeg-dev \
    libwebp-dev \
    liblqr-dev \
    libglib2.0-dev \
    fonts-noto-color-emoji \
    curl ca-certificates xz-utils build-essential git \
 && rm -rf /var/lib/apt/lists/*

# Install liblqr
RUN DIR=/tmp/liblqr && \
    mkdir -p ${DIR} && \
    cd ${DIR} && \
    git clone https://github.com/carlobaldassi/liblqr.git ${DIR} -b v0.4.2 --depth 1 && \
    ./configure --enable-shared && \
    make check && \
    make install && \
    rm -rf ${DIR}

# Download ImageMagick source
RUN cd /tmp \
 && curl -SLO "https://imagemagick.org/download/releases/ImageMagick-${IMAGEMAGICK_VERSION}.tar.xz" \
 && curl -SLO "https://imagemagick.org/download/releases/ImageMagick-${IMAGEMAGICK_VERSION}.tar.xz.asc" \
 && tar xf "ImageMagick-${IMAGEMAGICK_VERSION}.tar.xz"

# Configure and install
RUN cd "/tmp/ImageMagick-${IMAGEMAGICK_VERSION}" \
 && ./configure \
    --with-webp=yes \
    --with-png=yes \
    --with-jpeg=yes \
    --with-lqr=yes \
 && make \
 && make install \
 && ldconfig /usr/local/lib

WORKDIR /server
COPY --from=npm_dependencies /server/node_modules ./node_modules
COPY package*.json ./
COPY src src

COPY docker/docker-entrypoint.sh /usr/local/bin/

USER node

ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "src/app.ts"]

