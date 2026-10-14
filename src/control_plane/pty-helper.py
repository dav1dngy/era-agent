#!/usr/bin/env python3
# Minimal pseudo-terminal bridge for ERA Studio's terminal (no native Node modules needed).
# argv: shell command and arguments. stdin/stdout carry the terminal bytes; file descriptor 3 carries
# control lines from ERA: "resize <cols> <rows>". Exits with the shell's status.
import fcntl, os, pty, select, signal, struct, sys, termios

pid, fd = pty.fork()
if pid == 0:
    os.execvp(sys.argv[1], sys.argv[1:])

def resize(cols, rows):
    fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", rows, cols, 0, 0))
    os.kill(pid, signal.SIGWINCH)

ctl = os.fdopen(3, "r", buffering=1) if os.path.exists("/dev/fd/3") else None
inputs = [sys.stdin.fileno(), fd] + ([ctl.fileno()] if ctl else [])
status = 0
try:
    while True:
        ready, _, _ = select.select(inputs, [], [])
        if fd in ready:
            try:
                data = os.read(fd, 65536)
            except OSError:
                data = b""
            if not data:
                break
            os.write(sys.stdout.fileno(), data)
        if sys.stdin.fileno() in ready:
            data = os.read(sys.stdin.fileno(), 65536)
            if not data:
                os.kill(pid, signal.SIGHUP)
                break
            os.write(fd, data)
        if ctl and ctl.fileno() in ready:
            line = ctl.readline()
            if not line:
                inputs.remove(ctl.fileno())
            else:
                parts = line.split()
                if len(parts) == 3 and parts[0] == "resize":
                    try:
                        resize(int(parts[1]), int(parts[2]))
                    except (ValueError, OSError):
                        pass
finally:
    try:
        _, st = os.waitpid(pid, 0)
        status = os.waitstatus_to_exitcode(st)
    except ChildProcessError:
        pass
sys.exit(status if status >= 0 else 1)
