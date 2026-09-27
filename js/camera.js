// Camera stream and 3:4 portrait capture.

export const CAPTURE_WIDTH = 768;
export const CAPTURE_HEIGHT = 1024;

export class Camera {
  constructor(video) {
    this.video = video;
    this.stream = null;
    this.facingMode = 'user';
  }

  get isMirrored() {
    return this.facingMode === 'user';
  }

  async start(facingMode = this.facingMode) {
    this.stop();
    this.facingMode = facingMode;
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      const error = new Error('Insecure context');
      error.name = 'InsecureContextError';
      throw error;
    }
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: { ideal: facingMode },
          width: { ideal: 1920 },
          height: { ideal: 1920 },
        },
      });
    } catch (error) {
      // Some laptop webcams reject the preferred constraints: retry with none.
      if (error?.name !== 'OverconstrainedError' && error?.name !== 'NotReadableError') throw error;
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: true });
    }
    this.video.srcObject = this.stream;
    this.video.classList.toggle('mirrored', this.isMirrored);
    await this.video.play();
    // Wait for real dimensions before anyone tries to capture.
    if (!this.video.videoWidth) {
      await new Promise((resolve) => this.video.addEventListener('loadedmetadata', resolve, { once: true }));
    }
  }

  stop() {
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
  }

  flip() {
    return this.start(this.facingMode === 'user' ? 'environment' : 'user');
  }

  /**
   * Grabs the current frame, cropped to 3:4 exactly like the viewfinder's
   * `object-fit: cover`, and mirrored like the preview for the front camera.
   */
  capture() {
    const { videoWidth: vw, videoHeight: vh } = this.video;
    if (!vw || !vh) throw new Error('La caméra ne renvoie pas encore d’image.');

    const target = CAPTURE_WIDTH / CAPTURE_HEIGHT;
    let sw = vw;
    let sh = vh;
    if (vw / vh > target) sw = vh * target;
    else sh = vw / target;
    const sx = (vw - sw) / 2;
    const sy = (vh - sh) / 2;

    const canvas = document.createElement('canvas');
    canvas.width = CAPTURE_WIDTH;
    canvas.height = CAPTURE_HEIGHT;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (this.isMirrored) {
      ctx.translate(CAPTURE_WIDTH, 0);
      ctx.scale(-1, 1);
    }
    ctx.drawImage(this.video, sx, sy, sw, sh, 0, 0, CAPTURE_WIDTH, CAPTURE_HEIGHT);
    return canvas;
  }
}
