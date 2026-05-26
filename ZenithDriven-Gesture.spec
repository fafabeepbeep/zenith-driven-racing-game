# -*- mode: python ; coding: utf-8 -*-
from PyInstaller.utils.hooks import collect_data_files

datas = [('models/gestureModel.task', 'models')]
datas += collect_data_files('mediapipe')
datas += collect_data_files('cv2')


a = Analysis(
    ['gestureControl.py'],
    pathex=[],
    binaries=[],
    datas=datas,
    hiddenimports=['mediapipe', 'cv2', 'websocket', 'certifi'],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
    optimize=0,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name='ZenithDriven-Gesture',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    console=False,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)
coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=True,
    upx_exclude=[],
    name='ZenithDriven-Gesture',
)
app = BUNDLE(
    coll,
    name='ZenithDriven-Gesture.app',
    icon=None,
    bundle_identifier='com.fareehah.zenithdriven',
)
