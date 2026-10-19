#!/usr/bin/env python3
"""Run an isolated Emery emulator for Index (Alloy) without stopping other emulators.

Alloy needs a firmware with the Moddable runtime, so this boots the 4.33.1 SDK's Emery
image (older SDKs predate Alloy). The window is visible by default; --headless runs it
without one, for screenshots taken through the QEMU monitor.

    ~/.local/share/uv/tools/pebble-tool/bin/python tools/emulator.py --state /tmp/index-emery
    pebble install --phone localhost:<base-port + 4> dist/index-alloy-playtest.pbw

Ports from --base-port: +0/+1 serial, +2 gdb, +3 QEMU monitor (screendump, sendkey),
+4 the companion (pypkjs), which `pebble install --phone` treats as a phone.
"""
import argparse
import bz2
import socket
import subprocess
import sys
import time
from pathlib import Path

parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
parser.add_argument('--sdk', type=Path,
                    default=Path.home() / 'Library/Application Support/Pebble SDK/SDKs/4.33.1')
parser.add_argument('--python', type=Path,
                    default=Path.home() / '.local/share/uv/tools/pebble-tool/bin/python')
parser.add_argument('--state', type=Path, default=Path('/tmp/index-emery'))
parser.add_argument('--base-port', type=int, default=54401)
parser.add_argument('--headless', action='store_true')
arguments = parser.parse_args()

firmware = arguments.sdk / 'sdk-core/pebble/emery/qemu'
emulator = arguments.sdk / 'toolchain/bin/qemu-pebble'
if not firmware.is_dir() or not emulator.exists() or not arguments.python.exists():
    parser.error('SDK or Python runtime not found; supply --sdk and --python.')
if not 1024 <= arguments.base_port <= 65531:
    parser.error('--base-port must be between 1024 and 65531.')
for port in range(arguments.base_port, arguments.base_port + 5):
    with socket.socket() as probe:
        try:
            probe.bind(('127.0.0.1', port))
        except OSError:
            parser.error(f'Port {port} is in use. Reuse that emulator or choose another --base-port.')

arguments.state.mkdir(parents=True, exist_ok=True)
flash = arguments.state / 'qemu_spi_flash.bin'
if not flash.exists():
    flash.write_bytes(bz2.decompress((firmware / 'qemu_spi_flash.bin.bz2').read_bytes()))

port = arguments.base_port
processes, logs = [], []
try:
    logs.append((arguments.state / 'qemu.log').open('w'))
    processes.append(subprocess.Popen([
        str(emulator), '-rtc', 'base=localtime', '-serial', 'null',
        '-serial', f'tcp:127.0.0.1:{port},server=on,wait=off',
        '-serial', f'tcp:127.0.0.1:{port + 1},server=on,wait=off',
        '-kernel', str(firmware / 'qemu_micro_flash.bin'),
        '-gdb', f'tcp:127.0.0.1:{port + 2},server=on,wait=off',
        '-monitor', f'tcp:127.0.0.1:{port + 3},server=on,wait=off',
        '-machine', 'pebble-emery', '-cpu', 'cortex-m33',
        '-drive', f'if=mtd,format=raw,file={flash}',
        '-display', 'none' if arguments.headless else 'cocoa'],
        stdin=subprocess.DEVNULL, stdout=logs[-1], stderr=subprocess.STDOUT))
    time.sleep(5)
    if processes[0].poll() is not None:
        raise RuntimeError('QEMU exited; see qemu.log.')
    logs.append((arguments.state / 'pypkjs.log').open('w'))
    processes.append(subprocess.Popen([
        str(arguments.python), '-m', 'pypkjs', '--qemu', f'localhost:{port}',
        '--port', str(port + 4), '--persist', str(arguments.state), '--debug',
        '--layout', str(firmware / 'layouts.json')],
        stdin=subprocess.DEVNULL, stdout=logs[-1], stderr=subprocess.STDOUT))
    print(f'Emery running. Install with: pebble install --phone localhost:{port + 4} PBW', flush=True)
    print(f'QEMU PID {processes[0].pid}; monitor on {port + 3}; logs and flash in {arguments.state}',
          flush=True)
    while all(process.poll() is None for process in processes):
        time.sleep(1)
    raise RuntimeError('The emulator or its companion exited; see the logs.')
except KeyboardInterrupt:
    pass
except Exception as error:
    print(error, file=sys.stderr)
    sys.exit(1)
finally:
    for process in reversed(processes):
        if process.poll() is None:
            process.terminate()
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait()
    for log in logs:
        log.close()
