FROM python:3.11-slim
ENV PYTHONUNBUFFERED=1

# Set working directory inside the container
WORKDIR /app

# Install system dependencies
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
    gcc build-essential git python3 cmake nodejs && \
    rm -rf /var/lib/apt/lists/*

# Install Emscripten SDK
RUN git clone https://github.com/emscripten-core/emsdk.git /emsdk && \
    cd /emsdk && \
    ./emsdk install latest && \
    ./emsdk activate latest

# Copy your application code and static files
COPY ./*.py ./
COPY ./thrilldigger/* ./thrilldigger/
COPY ./agent/* ./agent/
COPY ./public ./public
COPY ./requirements.txt ./requirements.txt

# Install dependencies from requirements.txt
RUN pip install --no-cache-dir -r requirements.txt
