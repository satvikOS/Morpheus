#!/usr/bin/env python3
"""Local HTTP smoke and malformed-request tests for the actual C++ process."""
import http.client
import json
import os
import signal
import socket
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BUILD = ROOT / "services/morpheus-cloud-cpp/build"
subprocess.run(["cmake", "-S", str(ROOT / "services/morpheus-cloud-cpp"), "-B", str(BUILD),
                "-DCMAKE_BUILD_TYPE=Release"], check=True)
subprocess.run(["cmake", "--build", str(BUILD), "--parallel", "4"], check=True)
with socket.socket() as probe:
    probe.bind(("127.0.0.1", 0))
    port = probe.getsockname()[1]
env = dict(os.environ, PORT=str(port), MORPHEUS_CLOUD_BIND="127.0.0.1")
process = subprocess.Popen([str(BUILD / "morpheus_cloud")], env=env,
                           stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
try:
    assert "listening" in process.stderr.readline()
    for route, status in [("/health", 200), ("/version", 200), ("/metadata", 200), ("/missing", 404),
                          ("/api/cloud-cpp/health", 200), ("/api/cloud-cpp/healthz", 200),
                          ("/api/cloud-cpp/version", 200), ("/api/cloud-cpp/metadata?source=preview", 200),
                          ("/api/cloud-cpp/missing", 404), ("/api/cloud-cpp-extra/health", 404)]:
        connection = http.client.HTTPConnection("127.0.0.1", port, timeout=5)
        connection.request("GET", route)
        response = connection.getresponse()
        assert response.status == status
        data = json.loads(response.read())
        if "/metadata" in route:
            assert data["acquisition_authority"] is False and data["persistent_jobs"] is False
            assert data["limits"]["request_header_bytes"] == 8192
        connection.close()
    connection = http.client.HTTPConnection("127.0.0.1", port, timeout=5)
    connection.request("POST", "/metadata", body=b"private-data")
    response = connection.getresponse()
    assert response.status == 405 and response.getheader("Allow") == "GET"
    response.read()
    connection.close()
    def raw_request(request):
        with socket.create_connection(("127.0.0.1", port), timeout=5) as sock:
            sock.sendall(request)
            response = http.client.HTTPResponse(sock)
            response.begin()
            body = response.read()
            assert b"never-echo-this-payload" not in body
            assert response.getheader("Connection") == "close"
            return response.status, json.loads(body)

    framing_cases = {
        "missing_host": b"GET /health HTTP/1.1\r\n\r\n",
        "missing_host_http10": b"GET /health HTTP/1.0\r\n\r\n",
        "empty_host": b"GET /health HTTP/1.1\r\nHost: \t\r\n\r\n",
        "duplicate_host": b"GET /health HTTP/1.1\r\nHost: test\r\nHost: other\r\n\r\n",
        "malformed_header": b"GET /health HTTP/1.1\r\nHost: test\r\nBadHeader\r\n\r\n",
        "whitespace_header_name": b"GET /health HTTP/1.1\r\nHost: test\r\nContent-Length : 0\r\n\r\n",
        "folded_header": b"GET /health HTTP/1.1\r\nHost: test\r\nX-Test: one\r\n\ttwo\r\n\r\n",
        "control_header_value": b"GET /health HTTP/1.1\r\nHost: test\r\nX-Test: \x00\r\n\r\n",
        "conflicting_lengths": b"GET /health HTTP/1.1\r\nHost: test\r\nContent-Length: 0\r\nContent-Length: 4\r\n\r\ntest",
        "duplicate_lengths": b"GET /health HTTP/1.1\r\nHost: test\r\nContent-Length: 0\r\nContent-Length: 0\r\n\r\n",
        "negative_length": b"GET /health HTTP/1.1\r\nHost: test\r\nContent-Length: -1\r\n\r\n",
        "length_overflow": b"GET /health HTTP/1.1\r\nHost: test\r\nContent-Length: 18446744073709551616\r\n\r\n",
        "comma_length": b"GET /health HTTP/1.1\r\nHost: test\r\nContent-Length: 0, 0\r\n\r\n",
        "invalid_length": b"GET /health HTTP/1.1\r\nHost: test\r\nContent-Length: 1x\r\n\r\n",
        "chunked_get": b"GET /health HTTP/1.1\r\nHost: test\r\nTransfer-Encoding: chunked\r\n\r\n0\r\n\r\n",
        "mixed_case_transfer": b"GET /health HTTP/1.1\r\nHost: test\r\ntRaNsFeR-EnCoDiNg: identity\r\n\r\n",
        "length_and_transfer": b"GET /health HTTP/1.1\r\nHost: test\r\nContent-Length: 0\r\nTransfer-Encoding: chunked\r\n\r\n",
        "declared_get_body": b"GET /health HTTP/1.1\r\nHost: test\r\nContent-Length: 4\r\n\r\ntest",
        "declared_body_without_bytes": b"GET /health HTTP/1.1\r\nHost: test\r\nContent-Length: 4\r\n\r\n",
        "body_with_zero_length": b"GET /health HTTP/1.1\r\nHost: test\r\nContent-Length: 0\r\n\r\nnever-echo-this-payload",
        "unframed_get_body": b"GET /health HTTP/1.1\r\nHost: test\r\n\r\nnever-echo-this-payload",
        "prefixed_get_body": b"GET /api/cloud-cpp/metadata HTTP/1.1\r\nHost: test\r\nContent-Length: 4\r\n\r\ntest",
        "extra_request_line_space": b"GET  /health HTTP/1.1\r\nHost: test\r\n\r\n",
        "post_conflicting_lengths": b"POST /metadata HTTP/1.1\r\nHost: test\r\nContent-Length: 0\r\nContent-Length: 4\r\n\r\ntest",
        "post_transfer_encoding": b"POST /metadata HTTP/1.1\r\nHost: test\r\nTransfer-Encoding: chunked\r\n\r\n0\r\n\r\n",
    }
    for case, request in framing_cases.items():
        status, body = raw_request(request)
        assert status == 400 and body.get("error"), (case, status, body)
    for request in [b"GET /health HTTP/1.1\r\nhOsT: test\r\nContent-Length: \t000\t\r\n\r\n",
                    b"GET /health HTTP/1.0\r\nHost: test\r\n\r\n"]:
        assert raw_request(request)[0] == 200
    connection = http.client.HTTPConnection("127.0.0.1", port, timeout=5)
    connection.request("POST", "/api/cloud-cpp/metadata", body=b"private-data")
    response = connection.getresponse()
    assert response.status == 405 and response.getheader("Allow") == "GET"
    response.read()
    connection.close()
    with socket.create_connection(("127.0.0.1", port), timeout=5) as sock:
        sock.sendall(b"GET /health HTTP/1.1\r\nX-Large: " + b"a" * 9000)
        assert b"431" in sock.recv(1024).split(b"\r\n")[0]
    with socket.create_connection(("127.0.0.1", port), timeout=5) as sock:
        sock.sendall(b"INVALID\r\n\r\n")
        assert b"400" in sock.recv(1024).split(b"\r\n")[0]
    with socket.create_connection(("127.0.0.1", port), timeout=5) as sock:
        sock.sendall(b"GET /health HTTP/1.1\r\n")
        assert b"408" in sock.recv(1024).split(b"\r\n")[0]
    print(json.dumps({"test": "cpp-public-http", "health": True, "honest_metadata": True,
                      "vercel_service_prefix": True, "prefix_boundary": True,
                      "post_rejected": True, "header_bound": True, "malformed_request": True,
                      "strict_framing_cases": len(framing_cases), "get_bodies_rejected": True,
                      "absolute_deadline": True, "vercel_deployment_verified": False}))
finally:
    process.send_signal(signal.SIGTERM)
    process.communicate(timeout=5)
    assert process.returncode == 0
