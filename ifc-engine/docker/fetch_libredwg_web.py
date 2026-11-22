"""Build step: downloads the @mlightcad/libredwg-web package, checks its npm integrity (sha512) and unpacks it.

    python fetch_libredwg_web.py <tarball URL> <base64 sha512> <target dir>
"""
import base64
import hashlib
import io
import sys
import tarfile
import urllib.request

url, integrity, target = sys.argv[1:4]
data = urllib.request.urlopen(url, timeout=60).read()
if base64.b64encode(hashlib.sha512(data).digest()).decode() != integrity:
    sys.exit(f"{url}: integrity check failed")
with tarfile.open(fileobj=io.BytesIO(data)) as tar:
    members = tar.getmembers()
    for member in members:
        member.name = member.name.split("/", 1)[1]  # npm tarballs keep everything under package/
    tar.extractall(target, members=members, filter="data")
