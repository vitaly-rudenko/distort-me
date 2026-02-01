FROM debian:bookworm

ENV VERSION="7.1.2-13"

# Dependencies for ImageMagick
RUN apt update -y \
 && apt install -y --no-install-recommends \
    # libltdl-dev \
    libpng-dev \
    libjpeg-dev \
    libwebp-dev \
    liblqr-dev \
    libglib2.0-dev \
    curl ca-certificates xz-utils build-essential git

# Remove pre-installed ImageMagick
RUN apt remove -y imagemagick

# Install liblqr
RUN \
    DIR=/tmp/liblqr && \
    mkdir -p ${DIR} && \
    cd ${DIR} && \
    git clone https://github.com/carlobaldassi/liblqr.git ${DIR} -b v0.4.2 --depth 1 && \
    ./configure --enable-shared && \
    make check && \
    make install && \
    rm -rf ${DIR}

# Download ImageMagick source
RUN cd /tmp \
 && curl -SLO "https://imagemagick.org/download/releases/ImageMagick-${VERSION}.tar.xz" \
 && curl -SLO "https://imagemagick.org/download/releases/ImageMagick-${VERSION}.tar.xz.asc" \
 && tar xf "ImageMagick-${VERSION}.tar.xz"

# Configure and install
RUN cd "/tmp/ImageMagick-${VERSION}" \
 && ./configure \
    --with-webp=yes \
    --with-png=yes \
    --with-jpeg=yes \
    --with-lqr=yes \
 && make \
 && make install \
 && ldconfig /usr/local/lib

ENTRYPOINT ["magick"]
