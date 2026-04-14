import cv2

print("OpenCV version:", cv2.__version__)

# Try indices 0, 1, 2
for index in range(3):
    cap = cv2.VideoCapture(index)
    if cap.isOpened():
        print(f"Camera found at index {index}")
        ret, frame = cap.read()
        if ret:
            print(f"  Frame captured: {frame.shape}")
        else:
            print(f"  Opened but could NOT read frame (permission issue likely)")
        cap.release()
    else:
        print(f"No camera at index {index}")