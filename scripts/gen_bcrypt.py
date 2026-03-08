#!/usr/bin/env python3
import subprocess, sys

try:
    import bcrypt
except ImportError:
    subprocess.check_call([sys.executable, "-m", "pip", "install", "bcrypt", "-q"])
    import bcrypt

pw_hash = bcrypt.hashpw(b"Admin123456", bcrypt.gensalt())
print(pw_hash.decode())
