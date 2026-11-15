#!/usr/bin/env sh
# Test-certificaten voor de TLS-tests (alleen voor tests; geen echte sleutels). Opnieuw maken: sh generate.sh
# Drie test-CA's (A, B en C) en bladcertificaten voor localhost/127.0.0.1: blad-a (door A), blad-a2 (vernieuwd, ook door A,
# andere sleutel), blad-b (door B: een andere leverancier met een eigen root) en blad-c (door C: een root die niemand
# vertrouwt). Twee tussencertificaten onder A (tussen-1 en tussen-2) met elk een blad (blad-t1, blad-t2): het bestand van
# het blad bevat ook het tussencertificaat, zoals een server de keten meestuurt (een wissel R10/R11 bij Let's Encrypt).
set -e
cd "$(dirname "$0")"
DAYS=36500
for ca in a b c; do
  openssl req -x509 -newkey rsa:2048 -nodes -keyout ca-$ca.key -out ca-$ca.pem -days $DAYS -subj "/CN=Vaultgate test CA $ca/O=test" 2>/dev/null
done
printf 'subjectAltName=DNS:localhost,IP:127.0.0.1\n' > san.ext
printf 'basicConstraints=critical,CA:true,pathlen:0\nkeyUsage=critical,keyCertSign,cRLSign\n' > ca.ext
for leaf in a a2 b c; do
  ca=$(echo $leaf | cut -c1)
  openssl req -newkey rsa:2048 -nodes -keyout blad-$leaf.key -out blad-$leaf.csr -subj "/CN=localhost" 2>/dev/null
  openssl x509 -req -in blad-$leaf.csr -CA ca-$ca.pem -CAkey ca-$ca.key -CAcreateserial -out blad-$leaf.pem -days $DAYS -extfile san.ext 2>/dev/null
  rm blad-$leaf.csr
done
for n in 1 2; do
  openssl req -newkey rsa:2048 -nodes -keyout tussen-$n.key -out tussen-$n.csr -subj "/CN=Vaultgate test tussen $n/O=test" 2>/dev/null
  openssl x509 -req -in tussen-$n.csr -CA ca-a.pem -CAkey ca-a.key -CAcreateserial -out tussen-$n.pem -days $DAYS -extfile ca.ext 2>/dev/null
  openssl req -newkey rsa:2048 -nodes -keyout blad-t$n.key -out blad-t$n.csr -subj "/CN=localhost" 2>/dev/null
  openssl x509 -req -in blad-t$n.csr -CA tussen-$n.pem -CAkey tussen-$n.key -CAcreateserial -out blad-t$n.pem -days $DAYS -extfile san.ext 2>/dev/null
  cat tussen-$n.pem >> blad-t$n.pem
  rm blad-t$n.csr tussen-$n.csr tussen-$n.key tussen-$n.pem
done
rm -f san.ext ca.ext ca-*.srl tussen-*.srl
