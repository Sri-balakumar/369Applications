// src/components/Camera/InAppCameraModal.js
//
// Shared in-app camera (one-tap shutter) that recovers from the Android
// "black preview / dead shutter" problem:
//  - the native camera mounts only after the Modal is shown and earlier
//    modals have finished closing, so it gets a real preview surface;
//  - the shutter is enabled only after onCameraReady;
//  - if the camera isn't ready in time it remounts once, then offers Retry;
//  - takePictureAsync is raced against a timeout so the shutter never stays
//    stuck (a hung capture used to leave the button disabled forever).
//
// Grep "[InAppCamera]" in Metro to follow what happened.

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Modal, View, Text, TouchableOpacity, ActivityIndicator, StyleSheet,
} from 'react-native';
import { Camera } from 'expo-camera';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { FONT_FAMILY } from '@constants/theme';
import { showToastMessage } from '@components/Toast';

const TAG = '[InAppCamera]';
const MOUNT_DELAY_MS = 250;     // after Modal onShow, before mounting the camera
const READY_TIMEOUT_MS = 4000;  // not ready by then → remount
const CAPTURE_TIMEOUT_MS = 8000;
const MAX_AUTO_REMOUNTS = 1;

export const withTimeout = (promise, ms, label) => new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(new Error(`${label} timed out`)), ms);
  promise.then(
    (v) => { clearTimeout(t); resolve(v); },
    (e) => { clearTimeout(t); reject(e); },
  );
});

/**
 * Watchdog for any expo-camera <Camera>: tracks readiness, remounts the
 * camera (via `mountKey`) when it doesn't become ready, and reports `failed`
 * once auto-remounts are used up. Spread `cameraProps` onto the <Camera> and
 * use `mountKey` as its React key.
 */
export const useCameraReadyWatchdog = (active) => {
  const [mountKey, setMountKey] = useState(0);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const autoRemounts = useRef(0);

  const remount = useCallback((reason) => {
    console.log(TAG, 'remount —', reason);
    setReady(false);
    setFailed(false);
    setMountKey((k) => k + 1);
  }, []);

  const retry = useCallback(() => {
    autoRemounts.current = 0;
    remount('user retry');
  }, [remount]);

  // Reset whenever the camera is (re)activated.
  useEffect(() => {
    if (!active) return;
    autoRemounts.current = 0;
    setReady(false);
    setFailed(false);
  }, [active]);

  // Not ready in time → remount once, then give up and show Retry.
  useEffect(() => {
    if (!active || ready || failed) return undefined;
    const t = setTimeout(() => {
      if (autoRemounts.current < MAX_AUTO_REMOUNTS) {
        autoRemounts.current += 1;
        remount('not ready after ' + READY_TIMEOUT_MS + 'ms');
      } else {
        console.warn(TAG, 'camera never became ready — showing Retry');
        setFailed(true);
      }
    }, READY_TIMEOUT_MS);
    return () => clearTimeout(t);
  }, [active, ready, failed, mountKey, remount]);

  const cameraProps = {
    onCameraReady: () => {
      console.log(TAG, 'camera ready (mount', mountKey + ')');
      setReady(true);
      setFailed(false);
    },
    onMountError: (e) => {
      console.warn(TAG, 'mount error:', e?.nativeEvent?.message || e?.message);
      setReady(false);
      setFailed(true);
    },
  };

  return { mountKey, ready, failed, remount, retry, cameraProps };
};

/**
 * Full-screen camera modal with a round shutter and optional front/back flip.
 * `onCapture(photo)` receives the expo-camera photo ({ uri, width, height,
 * base64? }); the modal does NOT close itself — the caller hides it.
 */
const InAppCameraModal = ({
  visible,
  title = 'Take Photo',
  initialFacing = 'back',
  allowFlip = true,
  captureOptions = { quality: 0.3, skipProcessing: true, exif: false },
  onCapture,
  onClose,
}) => {
  const cameraRef = useRef(null);
  const [shown, setShown] = useState(false);       // Modal onShow + delay passed
  const [facing, setFacing] = useState(initialFacing);
  const [capturing, setCapturing] = useState(false);
  const watchdog = useCameraReadyWatchdog(visible && shown);

  // Reset per open.
  useEffect(() => {
    if (!visible) {
      setShown(false);
      setCapturing(false);
      setFacing(initialFacing);
    }
  }, [visible, initialFacing]);

  const handleShow = () => {
    setTimeout(() => setShown(true), MOUNT_DELAY_MS);
  };

  const flip = () => {
    if (capturing) return;
    setFacing((f) => (f === 'back' ? 'front' : 'back'));
    watchdog.remount('flip camera');
  };

  const capture = async () => {
    if (capturing) return;
    if (!watchdog.ready || !cameraRef.current) {
      showToastMessage('Camera is starting, please wait…');
      return;
    }
    setCapturing(true);
    try {
      const photo = await withTimeout(
        cameraRef.current.takePictureAsync(captureOptions),
        CAPTURE_TIMEOUT_MS,
        'takePictureAsync',
      );
      console.log(TAG, 'captured', photo?.uri, `${photo?.width}x${photo?.height}`);
      if (!photo?.uri) throw new Error('No photo returned');
      await onCapture?.(photo);
    } catch (e) {
      console.warn(TAG, 'capture failed:', e?.message);
      showToastMessage("Couldn't take photo, please try again");
      watchdog.remount('capture failed');
    } finally {
      setCapturing(false);
    }
  };

  const type = facing === 'front' ? Camera.Constants.Type.front : Camera.Constants.Type.back;
  const shutterEnabled = watchdog.ready && !capturing;

  return (
    <Modal visible={visible} animationType="slide" onShow={handleShow} onRequestClose={onClose}>
      <View style={styles.container}>
        {visible && shown ? (
          <Camera
            key={watchdog.mountKey}
            ref={cameraRef}
            style={StyleSheet.absoluteFill}
            type={type}
            {...watchdog.cameraProps}
          />
        ) : null}

        <View style={styles.overlay} pointerEvents="box-none">
          <View style={styles.topBar}>
            <TouchableOpacity style={styles.iconBtn} onPress={onClose}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <MaterialCommunityIcons name="close" size={28} color="#fff" />
            </TouchableOpacity>
            <Text style={styles.title} numberOfLines={1}>{title}</Text>
            <View style={styles.iconBtn} />
          </View>

          {!watchdog.ready ? (
            <View style={styles.center} pointerEvents="box-none">
              {watchdog.failed ? (
                <>
                  <MaterialCommunityIcons name="camera-off" size={42} color="#fff" />
                  <Text style={styles.statusText}>Camera didn't start</Text>
                  <TouchableOpacity style={styles.retryBtn} onPress={watchdog.retry}>
                    <MaterialCommunityIcons name="refresh" size={18} color="#000" />
                    <Text style={styles.retryText}>Retry</Text>
                  </TouchableOpacity>
                </>
              ) : (
                <>
                  <ActivityIndicator size="large" color="#fff" />
                  <Text style={styles.statusText}>Starting camera…</Text>
                </>
              )}
            </View>
          ) : null}

          <View style={styles.bottomBar}>
            <View style={styles.iconBtn} />
            <TouchableOpacity
              style={[styles.shutterBtn, !shutterEnabled && { opacity: 0.4 }]}
              onPress={capture}
              disabled={capturing}
              activeOpacity={0.7}
            >
              {capturing
                ? <ActivityIndicator color="#fff" />
                : <View style={styles.shutterInner} />}
            </TouchableOpacity>
            {allowFlip ? (
              <TouchableOpacity style={styles.iconBtn} onPress={flip} disabled={capturing}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                <MaterialCommunityIcons name="camera-flip-outline" size={30} color="#fff" />
              </TouchableOpacity>
            ) : <View style={styles.iconBtn} />}
          </View>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  overlay: { flex: 1, justifyContent: 'space-between' },
  topBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingTop: 50, paddingBottom: 16,
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  iconBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  title: { flex: 1, textAlign: 'center', color: '#fff', fontFamily: FONT_FAMILY.urbanistBold, fontSize: 16 },
  center: { alignItems: 'center', justifyContent: 'center', gap: 12 },
  statusText: { color: '#fff', fontFamily: FONT_FAMILY.urbanistSemiBold, fontSize: 15 },
  retryBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: '#fff', paddingHorizontal: 18, paddingVertical: 10, borderRadius: 22,
  },
  retryText: { color: '#000', fontFamily: FONT_FAMILY.urbanistBold, fontSize: 15 },
  bottomBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around',
    paddingBottom: 50, paddingTop: 20, backgroundColor: 'rgba(0,0,0,0.4)',
  },
  shutterBtn: {
    width: 76, height: 76, borderRadius: 38,
    borderWidth: 4, borderColor: '#fff',
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.2)',
  },
  shutterInner: { width: 60, height: 60, borderRadius: 30, backgroundColor: '#fff' },
});

export default InAppCameraModal;
