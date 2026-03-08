#!/usr/bin/env python3
"""Register admin user on xiaozhi-esp32-server with SM2 encryption."""
import urllib.request
import json
import sys

SM2_PUBLIC_KEY = "0473afba64bf5e930cdaba316a204056482b61263bc9b1ae2e5a6897da35897eb61e2db3faf66560eb7b67da74b85ce506326e3131f02ddf53f9b7206d1e2b498f"
BASE_URL = "http://localhost:8002/xiaozhi"

def sm2_encrypt(plaintext, public_key_hex):
    from gmssl import sm2
    key = public_key_hex[2:] if public_key_hex.startswith("04") else public_key_hex
    crypt = sm2.CryptSM2(public_key=key, private_key="")
    enc_data = crypt.encrypt(plaintext.encode("utf-8"))
    # gmssl returns bytes that already include the C1 point (with 04 prefix)
    # The JS frontend wraps as "04" + doEncrypt(). doEncrypt may exclude the 04 byte.
    # Try returning with the "04" prefix matching JS frontend behavior.
    hex_str = enc_data.hex()
    if not hex_str.startswith("04"):
        hex_str = "04" + hex_str
    return hex_str

def get_pub_config():
    req = urllib.request.Request(f"{BASE_URL}/user/pub-config")
    with urllib.request.urlopen(req) as resp:
        data = json.loads(resp.read().decode("utf-8"))
    return data.get("data", {}).get("sm2PublicKey", SM2_PUBLIC_KEY)

def register(username, password):
    pub_key = get_pub_config()
    print(f"SM2 public key: {pub_key[:20]}...")

    encrypted_pw = sm2_encrypt(password, pub_key)
    print(f"Encrypted (first 40 chars): {encrypted_pw[:40]}...")
    print(f"Starts with 04: {encrypted_pw.startswith('04')}")
    print(f"Total hex length: {len(encrypted_pw)}")

    payload = json.dumps({"username": username, "password": encrypted_pw}).encode("utf-8")
    req = urllib.request.Request(
        f"{BASE_URL}/user/register",
        data=payload,
        headers={"Content-Type": "application/json"}
    )
    try:
        with urllib.request.urlopen(req) as resp:
            result = resp.read().decode("utf-8")
            print(f"Response: {result}")
            return json.loads(result)
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8")
        print(f"HTTP {e.code}: {body}")
        return json.loads(body)

if __name__ == "__main__":
    result = register("admin", "Admin123456")
    print(f"\nResult code: {result.get('code')}")
    print(f"Result msg: {result.get('msg')}")

    if result.get("code") != 0:
        # Try without 04 prefix
        print("\n--- Trying without extra 04 prefix ---")
        from gmssl import sm2
        pub_key = get_pub_config()
        key = pub_key[2:] if pub_key.startswith("04") else pub_key
        crypt = sm2.CryptSM2(public_key=key, private_key="")
        enc = crypt.encrypt("Admin123456".encode("utf-8"))
        hex_no_prefix = enc.hex()
        print(f"Without prefix (first 40): {hex_no_prefix[:40]}...")
        
        payload2 = json.dumps({"username": "admin", "password": hex_no_prefix}).encode("utf-8")
        req2 = urllib.request.Request(
            f"{BASE_URL}/user/register",
            data=payload2,
            headers={"Content-Type": "application/json"}
        )
        try:
            with urllib.request.urlopen(req2) as resp2:
                r2 = resp2.read().decode("utf-8")
                print(f"Response (no prefix): {r2}")
        except urllib.error.HTTPError as e2:
            print(f"HTTP {e2.code}: {e2.read().decode('utf-8')}")
