"use strict";

const video = document.getElementById("camera");
const stage = document.getElementById("stage");
const canvas = document.getElementById("view");
const ctx = canvas.getContext("2d");

const startButton = document.getElementById("startButton");
const shootButton = document.getElementById("shootButton");
const flash = document.getElementById("flash");

const preview = document.getElementById("preview");
const resultImage = document.getElementById("resultImage");
const closeButton = document.getElementById("closeButton");
const saveButton = document.getElementById("saveButton");

// 写真は常に縦長の9:16
canvas.width = 1080;
canvas.height = 1920;

const W = canvas.width;
const H = canvas.height;

let stream = null;
let starting = false;
let running = false;
let generation = 0;
let animationId = null;

let firstFrameAt = null;
let nextBlinkAt = 0;
let blinkUntil = 0;
let alienVisible = false;

let openImage = null;
let closedImage = null;
let photoUrl = null;
let takingPhoto = false;

// 宇宙人の中心座標と横幅
const alien = {
  x: W * 0.5,
  y: H * 0.43,
  width: W * 0.52
};

const pointers = new Map();
let gesture = null;
let displayedFloat = 0;

const clamp = (value, min, max) =>
  Math.max(min, Math.min(max, value));

// ブラウザの表示領域に収まる縦長サイズ
function resizeStage() {
  const style = getComputedStyle(document.body);

  const availableWidth =
    document.body.clientWidth -
    (parseFloat(style.paddingLeft) || 0) -
    (parseFloat(style.paddingRight) || 0);

  const availableHeight =
    document.body.clientHeight -
    (parseFloat(style.paddingTop) || 0) -
    (parseFloat(style.paddingBottom) || 0);

  const width = Math.min(
    availableWidth,
    availableHeight * 9 / 16
  );

  stage.style.width = `${width}px`;
  stage.style.height = `${width * 16 / 9}px`;

  resetGesture();
}

window.addEventListener("resize", resizeStage);
window.visualViewport?.addEventListener("resize", resizeStage);
resizeStage();

function loadImage(path) {
  return new Promise((resolve, reject) => {
    const image = new Image();

    image.onload = () => resolve(image);
    image.onerror = () =>
      reject(new Error(`画像を読み込めません: ${path}`));

    image.src = path;
  });
}

async function prepareImages() {
  if (openImage && closedImage) return;

  [openImage, closedImage] = await Promise.all([
    loadImage("./assets/alien-open.png"),
    loadImage("./assets/alien-closed.png")
  ]);
}

async function startCamera() {
  if (starting || running) return;

  const token = ++generation;

  starting = true;
  startButton.hidden = true;
  shootButton.disabled = true;

  let candidate = null;

  try {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error("カメラを利用できません。");
    }

    candidate = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        facingMode: { ideal: "environment" },
        width: { ideal: 1080 },
        height: { ideal: 1920 }
      }
    });

    if (token !== generation) {
      candidate.getTracks().forEach(track => track.stop());
      return;
    }

    stream = candidate;
    video.srcObject = stream;
    video.muted = true;
    video.playsInline = true;

    await video.play();

    if (token !== generation) return;

    running = true;
    firstFrameAt = null;
    alienVisible = false;
    displayedFloat = 0;

    animationId = requestAnimationFrame(draw);

    try {
      await prepareImages();
    } catch (error) {
      if (token !== generation) return;

      console.error(error);
      startButton.hidden = false;
    }
  } catch (error) {
    candidate?.getTracks().forEach(track => track.stop());

    if (token !== generation) return;

    console.error(error);
    stopCamera();
    startButton.hidden = false;
  } finally {
    if (token === generation) starting = false;
  }
}

function draw(now) {
  if (!running) return;

  if (video.readyState >= 2 && video.videoWidth > 0) {
    if (firstFrameAt === null) {
      firstFrameAt = now;
      nextBlinkAt = now + 5000;
      blinkUntil = 0;
    }

    // 元映像が横長でも、中央を縦長に切り抜く
    const scale = Math.max(
      W / video.videoWidth,
      H / video.videoHeight
    );

    const cropWidth = W / scale;
    const cropHeight = H / scale;

    ctx.drawImage(
      video,
      (video.videoWidth - cropWidth) / 2,
      (video.videoHeight - cropHeight) / 2,
      cropWidth,
      cropHeight,
      0,
      0,
      W,
      H
    );

    const elapsed = now - firstFrameAt;

    alienVisible =
      elapsed >= 3000 &&
      Boolean(openImage && closedImage);

    if (alienVisible) {
      // ときどき瞬きする
      if (now >= nextBlinkAt) {
        blinkUntil = now + 170;
        nextBlinkAt = now + 2200 + Math.random() * 1500;
      }

      const image = now < blinkUntil
        ? closedImage
        : openImage;

      // 約3秒周期で上下に浮遊
      // 操作中は浮遊位置を固定し、指で動かしやすくする
      if (pointers.size === 0) {
        const target = Math.sin(elapsed * Math.PI * 2 / 3000) * 28;
        displayedFloat += (target - displayedFloat) * 0.12;
      }

      const height =
        alien.width * openImage.naturalHeight / openImage.naturalWidth;

      ctx.save();
      ctx.globalAlpha = clamp((elapsed - 3000) / 450, 0, 1);

      ctx.drawImage(
        image,
        alien.x - alien.width / 2,
        alien.y - height / 2 + displayedFloat,
        alien.width,
        height
      );

      ctx.restore();
    }

    shootButton.disabled = takingPhoto;
  }

  animationId = requestAnimationFrame(draw);
}

// タッチ位置を写真の座標へ変換
function pointFromEvent(event) {
  const rect = canvas.getBoundingClientRect();

  return {
    x: (event.clientX - rect.left) * W / rect.width,
    y: (event.clientY - rect.top) * H / rect.height
  };
}

function hitsAlien(point) {
  if (!alienVisible) return false;

  const height =
    alien.width * openImage.naturalHeight / openImage.naturalWidth;

  // 少し余裕を持たせてつかみやすくする
  const margin = 45;

  return (
    Math.abs(point.x - alien.x) <= alien.width / 2 + margin &&
    Math.abs(point.y - alien.y - displayedFloat) <= height / 2 + margin
  );
}

function midpoint(a, b) {
  return {
    x: (a.x + b.x) / 2,
    y: (a.y + b.y) / 2
  };
}

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

// 指の本数が変わるたびに基準を更新
function beginGesture() {
  const points = [...pointers.values()];

  if (points.length === 0) {
    gesture = null;
    return;
  }

  gesture = {
    x: alien.x,
    y: alien.y,
    width: alien.width,
    center: points.length === 1
      ? points[0]
      : midpoint(points[0], points[1]),
    distance: points.length === 2
      ? Math.max(1, distance(points[0], points[1]))
      : 1
  };
}

canvas.addEventListener("pointerdown", event => {
  if (!alienVisible || !preview.hidden || pointers.size >= 2) return;

  const point = pointFromEvent(event);

  // 最初の指は宇宙人に触れたときだけ操作開始
  if (pointers.size === 0 && !hitsAlien(point)) return;

  event.preventDefault();
  canvas.setPointerCapture(event.pointerId);
  pointers.set(event.pointerId, point);
  beginGesture();
});

canvas.addEventListener("pointermove", event => {
  if (!pointers.has(event.pointerId) || !gesture) return;

  event.preventDefault();
  pointers.set(event.pointerId, pointFromEvent(event));

  const points = [...pointers.values()];

  if (points.length === 1) {
    // 1本指で移動
    alien.x = gesture.x + points[0].x - gesture.center.x;
    alien.y = gesture.y + points[0].y - gesture.center.y;
  } else {
    // 2本指で拡大縮小＋移動
    const center = midpoint(points[0], points[1]);
    const ratio = distance(points[0], points[1]) / gesture.distance;

    alien.width = clamp(gesture.width * ratio, W * 0.15, W * 1.3);

    const actualRatio = alien.width / gesture.width;

    alien.x =
      center.x + (gesture.x - gesture.center.x) * actualRatio;

    alien.y =
      center.y +
      (gesture.y + displayedFloat - gesture.center.y) * actualRatio -
      displayedFloat;
  }

  // 画面の外へ完全に消えないようにする
  alien.x = clamp(alien.x, 0, W);
  alien.y = clamp(alien.y, 0, H);
});

function endPointer(event) {
  if (!pointers.delete(event.pointerId)) return;
  beginGesture();
}

canvas.addEventListener("pointerup", endPointer);
canvas.addEventListener("pointercancel", endPointer);
canvas.addEventListener("lostpointercapture", endPointer);

function resetGesture() {
  for (const id of pointers.keys()) {
    if (canvas.hasPointerCapture(id)) {
      canvas.releasePointerCapture(id);
    }
  }

  pointers.clear();
  gesture = null;
}

function takePhoto() {
  if (!running || firstFrameAt === null || takingPhoto) return;

  resetGesture();
  takingPhoto = true;
  shootButton.disabled = true;

  // 表示と同じ位置・大きさで保存
  const photo = document.createElement("canvas");
  photo.width = W;
  photo.height = H;
  photo.getContext("2d").drawImage(canvas, 0, 0);

  flash.animate(
    [{ opacity: 0.9 }, { opacity: 0 }],
    { duration: 250 }
  );

  const token = generation;

  photo.toBlob(blob => {
    takingPhoto = false;

    if (!blob || token !== generation) return;

    if (photoUrl) URL.revokeObjectURL(photoUrl);

    photoUrl = URL.createObjectURL(blob);
    resultImage.src = photoUrl;
    saveButton.href = photoUrl;
    saveButton.download = `alien-${Date.now()}.png`;

    preview.hidden = false;
  }, "image/png");
}

shootButton.addEventListener("click", takePhoto);

closeButton.addEventListener("click", () => {
  preview.hidden = true;
});

startButton.addEventListener("click", async () => {
  if (!running) {
    await startCamera();
    return;
  }

  startButton.hidden = true;

  try {
    await prepareImages();
  } catch (error) {
    console.error(error);
    startButton.hidden = false;
  }
});

function stopCamera() {
  generation++;
  starting = false;
  running = false;
  alienVisible = false;
  firstFrameAt = null;
  takingPhoto = false;

  resetGesture();
  cancelAnimationFrame(animationId);

  stream?.getTracks().forEach(track => track.stop());
  stream = null;
  video.srcObject = null;
  shootButton.disabled = true;
}

window.addEventListener("pagehide", () => {
  stopCamera();

  preview.hidden = true;
  resultImage.removeAttribute("src");
  saveButton.removeAttribute("href");

  if (photoUrl) {
    URL.revokeObjectURL(photoUrl);
    photoUrl = null;
  }
});

window.addEventListener("pageshow", event => {
  if (event.persisted) startCamera();
});

startCamera();