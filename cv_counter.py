# cv_counter.py
# Phase 3: Webcam / video-file person counter using YOLOv8n.
# Posts observations to the Green Twin API every ~2 seconds.
#
# ==========================================================================
# PRIVACY NOTICE -- READ BEFORE MODIFYING
# ==========================================================================
# This file is designed to be privacy-safe by construction:
#   1. NO frames or video are ever saved to disk.
#      (no cv2.imwrite, no cv2.VideoWriter, no ultralytics save=True)
#   2. NO face recognition, person identification, or individual tracking.
#      We count boxes, nothing else.
#   3. ONLY numeric data leaves this process: person_count (int),
#      confidence (float), light_on (bool), ts (string), room_id (string).
#      No images, no embeddings, no bounding-box coordinates are sent.
# ==========================================================================

import argparse
import time
import statistics
from datetime import datetime
from collections import deque

import cv2                    # pip install opencv-python
import requests               # pip install requests
from ultralytics import YOLO  # pip install ultralytics

# YOLO class index for "person" in the COCO dataset.
PERSON_CLASS = 0

# Default confidence threshold for YOLO detections.
YOLO_CONF = 0.4

# How often (seconds) we send an observation to the API.
SEND_INTERVAL = 2.0

# How many recent person-count readings to median-smooth over.
# Smoothing reduces flicker caused by one missed or extra detection.
SMOOTH_WINDOW = 3


# -----------------------------------------------------------------------
# Parse command-line arguments
# -----------------------------------------------------------------------

def parse_args():
    """
    Define and return the command-line arguments.
    Keeping this in one place makes it easy to see what the script accepts.
    """
    parser = argparse.ArgumentParser(
        description="Count people via webcam/video and send to Green Twin API."
    )
    parser.add_argument(
        "--room",
        default="R204",
        help="Room ID to tag observations with (default: R204)"
    )
    parser.add_argument(
        "--source",
        default="0",
        help="Webcam index (e.g. 0) or path to a video file"
    )
    parser.add_argument(
        "--brightness-threshold",
        type=float,
        default=50.0,
        help="Mean frame brightness (0-255) above which we assume the light is ON. "
             "Default 50 works for most indoor rooms. Tune for your setup."
    )
    parser.add_argument(
        "--api-url",
        default="http://localhost:8000",
        help="Base URL of the Green Twin API server"
    )
    parser.add_argument(
        "--verbose",
        action="store_true",
        help="Print detailed numbers (raw/smoothed count, conf, brightness, light_on, HTTP status) each cycle."
    )
    return parser.parse_args()


# -----------------------------------------------------------------------
# Brightness -> light_on proxy
# -----------------------------------------------------------------------

def estimate_light_on(frame, threshold):
    """
    Convert the frame to greyscale, compute the mean pixel value,
    and return (light_on, mean_brightness).

    IMPORTANT: This is only a VISUAL PROXY for the light being on.
    It is NOT an electrical measurement. A bright window, a projector,
    or even a dark room with a bright screen can fool it.
    The threshold should be tuned for the specific room's baseline.
    """
    grey = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
    mean_brightness = float(grey.mean())
    return mean_brightness > threshold, mean_brightness


# -----------------------------------------------------------------------
# Run YOLO on one frame, return (person_count, mean_confidence)
# -----------------------------------------------------------------------

def detect_persons(model, frame):
    """
    Run YOLOv8n on the frame and count PERSON boxes only (class 0).
    Returns:
        person_count  - integer, number of person detections
        mean_conf     - mean confidence of those detections (0.5 if none)

    We explicitly set save=False and verbose=False to:
      - Avoid writing annotated images to disk (PRIVACY rule).
      - Suppress per-frame YOLO terminal noise.
    """
    results = model.predict(
        source=frame,
        classes=[PERSON_CLASS],   # only detect people
        conf=YOLO_CONF,
        save=False,               # PRIVACY: never write images to disk
        verbose=False,            # no per-frame terminal spam
    )

    # results[0].boxes holds all detections for this frame.
    boxes = results[0].boxes

    if boxes is None or len(boxes) == 0:
        # No people detected -- confidence defaults to 0.5 (uncertain, not zero)
        return 0, 0.5

    # Filter to person class just in case (model should already have done it).
    person_confs = [
        float(box.conf)
        for box in boxes
        if int(box.cls) == PERSON_CLASS
    ]

    if not person_confs:
        return 0, 0.5

    # Mean confidence across all person boxes in this frame.
    return len(person_confs), statistics.mean(person_confs)


# -----------------------------------------------------------------------
# Post one observation to the API
# -----------------------------------------------------------------------

def post_observation(api_url, room_id, person_count, confidence, light_on, verbose=False, raw_count=None, brightness=None):
    """
    Build an observation dict and POST it to /observation.
    We only send numbers and a timestamp -- no image data.
    Logs an error if the POST fails but does NOT crash the capture loop.
    Returns HTTP status code (or None if failed).
    """
    obs = {
        "room_id": room_id,
        "ts": datetime.now().isoformat(timespec="seconds"),
        "person_count": person_count,
        "confidence": round(confidence, 3),
        "light_on": light_on,
    }
    status_code = None
    try:
        r = requests.post(f"{api_url}/observation", json=obs, timeout=3)
        status_code = r.status_code
        r.raise_for_status()
        if verbose:
            print(f"[VERBOSE] raw={raw_count} smoothed={person_count} conf={obs['confidence']:.3f} "
                  f"brightness={brightness:.1f} light_on={light_on} http={status_code}")
        else:
            print(f"[SENT] {obs['ts']}  room={room_id}  persons={person_count}"
                  f"  conf={obs['confidence']}  light={light_on}")
    except requests.exceptions.ConnectionError:
        print("[WARN] API server unreachable. Will retry next cycle.")
    except requests.exceptions.HTTPError as e:
        status_code = e.response.status_code
        if verbose:
            print(f"[VERBOSE] raw={raw_count} smoothed={person_count} conf={obs['confidence']:.3f} "
                  f"brightness={brightness:.1f} light_on={light_on} http={status_code}")
        print(f"[WARN] API returned {status_code}: {e.response.text}")
    except Exception as e:
        print(f"[WARN] Unexpected error posting observation: {e}")
    return status_code


# -----------------------------------------------------------------------
# Main capture loop
# -----------------------------------------------------------------------

def run(args):
    """
    Open the video source, load YOLOv8n, and loop until Ctrl+C or end of file.
    Every SEND_INTERVAL seconds we detect, measure brightness, smooth the count,
    and send one observation to the API.
    """
    # Load the smallest YOLOv8 model -- fast enough for 2-second intervals.
    print("[INFO] Loading YOLOv8n model...")
    model = YOLO("yolov8n.pt")   # downloads the 6 MB model on first run

    # Decide the video source: integer (webcam index) or file path string.
    source_arg = args.source
    try:
        source = int(source_arg)    # works if it's a number like "0"
    except ValueError:
        source = source_arg         # it's a file path

    print(f"[INFO] Opening video source: {source}")
    cap = cv2.VideoCapture(source)

    if not cap.isOpened():
        print(f"[ERROR] Could not open video source '{source}'.")
        print("  For webcam: use --source 0")
        print("  For a file: use --source path/to/video.mp4")
        return

    print(f"[INFO] Streaming. Sending to {args.api_url} every {SEND_INTERVAL}s.")
    print("[INFO] Press Ctrl+C to stop.\n")

    # A small queue to median-smooth the last SMOOTH_WINDOW person counts.
    # deque with maxlen automatically drops old values.
    recent_counts = deque(maxlen=SMOOTH_WINDOW)

    last_send_time = 0.0   # unix timestamp of the last POST we sent

    try:
        while True:
            ok, frame = cap.read()

            if not ok:
                # End of video file (webcam would loop or stall, not return False)
                print("[INFO] End of video file. Stopping.")
                break

            now = time.time()

            # Only run detection and POST every SEND_INTERVAL seconds.
            # This avoids hammering the API and the CPU on every frame.
            if now - last_send_time >= SEND_INTERVAL:
                # 1. Detect people in this frame.
                raw_count, mean_conf = detect_persons(model, frame)

                # 2. Smooth the count using the median of recent readings.
                #    Median is more robust than mean against single-frame spikes.
                recent_counts.append(raw_count)
                smoothed_count = int(statistics.median(recent_counts))

                # 3. Estimate whether the light is on from frame brightness.
                #    This is a visual proxy only (see function docstring).
                light_on, mean_brightness = estimate_light_on(frame, args.brightness_threshold)

                # 4. POST the observation. Only numbers go over the network.
                post_observation(
                    api_url=args.api_url,
                    room_id=args.room,
                    person_count=smoothed_count,
                    confidence=mean_conf,
                    light_on=light_on,
                    verbose=args.verbose,
                    raw_count=raw_count,
                    brightness=mean_brightness,
                )

                last_send_time = now

    except KeyboardInterrupt:
        # Ctrl+C is the normal way to stop the live webcam mode.
        print("\n[INFO] Stopped by user (Ctrl+C).")
    finally:
        # Always release the camera/file handle so other programs can use it.
        cap.release()
        print("[INFO] Camera released. Goodbye.")


# -----------------------------------------------------------------------
# Entry point
# -----------------------------------------------------------------------

if __name__ == "__main__":
    args = parse_args()
    run(args)
