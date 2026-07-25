#!/usr/bin/env python3
"""Hornet Bay social auto-poster (runs in GitHub Actions).

Two modes:
  push trigger          -> post the newest blog article (dedup via .social-state.json)
  workflow_dispatch     -> post the manual inputs; empty inputs = act like a push run

Channels activate only when their secrets are present; others report SKIP.
"""
import base64, hashlib, hmac, html, json, os, re, time, urllib.parse, urllib.request, uuid

STATE = '.social-state.json'
BLOG  = 'blog/index.html'
SITE  = 'https://hornetbay.com'

def http(method, url, headers=None, data=None):
    req = urllib.request.Request(url, data=data, method=method)
    for k, v in (headers or {}).items():
        req.add_header(k, v)
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            return r.status, r.read().decode('utf-8', 'replace')
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode('utf-8', 'replace')

# ---------------------------------------------------------------- X (Twitter)
def _oauth1_header(method, url, ck, cs, tok, sec):
    p = {'oauth_consumer_key': ck, 'oauth_nonce': uuid.uuid4().hex,
         'oauth_signature_method': 'HMAC-SHA1', 'oauth_timestamp': str(int(time.time())),
         'oauth_token': tok, 'oauth_version': '1.0'}
    enc = urllib.parse.quote
    base = '&'.join([method.upper(), enc(url, safe=''),
                     enc('&'.join(f'{enc(k, safe="~")}={enc(str(p[k]), safe="~")}' for k in sorted(p)), safe='')])
    key = f'{enc(cs, safe="")}&{enc(sec, safe="")}'
    p['oauth_signature'] = base64.b64encode(
        hmac.new(key.encode(), base.encode(), hashlib.sha1).digest()).decode()
    return 'OAuth ' + ', '.join(f'{enc(k, safe="")}="{enc(str(p[k]), safe="")}"'
                                for k in sorted(p) if k.startswith('oauth_'))

def x_upload_image(img_bytes, c):
    url = 'https://upload.twitter.com/1.1/media/upload.json'
    boundary = uuid.uuid4().hex
    body = (f'--{boundary}\r\nContent-Disposition: form-data; name="media"; '
            f'filename="img.png"\r\nContent-Type: application/octet-stream\r\n\r\n'
            ).encode() + img_bytes + f'\r\n--{boundary}--\r\n'.encode()
    auth = _oauth1_header('POST', url, c[0], c[1], c[2], c[3])
    st, resp = http('POST', url, {'Authorization': auth,
                    'Content-Type': f'multipart/form-data; boundary={boundary}'}, body)
    j = json.loads(resp)
    assert st in (200, 201, 202), f'media upload {st}: {resp[:200]}'
    return j['media_id_string']

def x_post(text, img_bytes, c):
    payload = {'text': text}
    if img_bytes:
        payload['media'] = {'media_ids': [x_upload_image(img_bytes, c)]}
    url = 'https://api.twitter.com/2/tweets'
    auth = _oauth1_header('POST', url, c[0], c[1], c[2], c[3])
    st, resp = http('POST', url, {'Authorization': auth, 'Content-Type': 'application/json'},
                    json.dumps(payload).encode())
    assert st in (200, 201), f'tweet {st}: {resp[:250]}'
    return json.loads(resp)['data']['id']

# ------------------------------------------------------- Facebook Page + IG
def fb_post(text, image_url, pid, tok):
    if image_url:
        st, r = http('POST', f'https://graph.facebook.com/v21.0/{pid}/photos',
                     data=urllib.parse.urlencode({'url': image_url, 'caption': text, 'access_token': tok}).encode())
    else:
        st, r = http('POST', f'https://graph.facebook.com/v21.0/{pid}/feed',
                     data=urllib.parse.urlencode({'message': text, 'access_token': tok}).encode())
    j = json.loads(r)
    assert st == 200 and 'id' in j, f'FB {st}: {r[:250]}'
    return j['id']

def ig_post(text, image_url, igid, tok):
    assert image_url, 'IG requires an image'
    st, r = http('POST', f'https://graph.facebook.com/v21.0/{igid}/media',
                 data=urllib.parse.urlencode({'image_url': image_url, 'caption': text, 'access_token': tok}).encode())
    j = json.loads(r)
    assert st == 200 and 'id' in j, f'IG container {st}: {r[:250]}'
    time.sleep(5)
    st, r = http('POST', f'https://graph.facebook.com/v21.0/{igid}/media_publish',
                 data=urllib.parse.urlencode({'creation_id': j['id'], 'access_token': tok}).encode())
    j2 = json.loads(r)
    assert st == 200 and 'id' in j2, f'IG publish {st}: {r[:250]}'
    return j2['id']

# --------------------------------------------------------------- blog parse
def latest_article():
    src = open(BLOG, encoding='utf-8').read()
    m = re.search(r'<article id="([^"]+)">(.*?)</article>', src, re.S)
    slug, body = m.group(1), m.group(2)
    t = re.search(r'class="title-link"[^>]*>(.*?)</a>', body, re.S)
    title = html.unescape(re.sub(r'<[^>]+>', '', t.group(1)).strip())
    p = re.search(r'<p>(.*?)</p>', body, re.S)
    para = html.unescape(re.sub(r'<[^>]+>', '', p.group(1)).strip()) if p else ''
    img = re.search(r'<img src="([^"]+)"', body)
    img_url = SITE + img.group(1) if img else None
    return slug, title, para, img_url

def truncate_x(title, excerpt, url):
    base = f'{title}\n\n{url}'
    room = 280 - len(base) - 3
    if len(excerpt) > room:
        excerpt = excerpt[:max(0, room-1)].rstrip() + '…'
    return f'{title}\n\n{excerpt}\n{url}'

# --------------------------------------------------------------------- main
def main():
    mode = os.environ.get('MODE', 'push')
    if mode == 'workflow_dispatch' and os.environ.get('IN_TITLE'):
        slug   = None
        title  = os.environ['IN_TITLE']
        para   = os.environ.get('IN_TEXT', '')
        img    = os.environ.get('IN_IMAGE') or None
        url    = SITE
    else:
        slug, title, para, img = latest_article()
        url = f'{SITE}/blog/{slug}'
        posted = json.load(open(STATE)) if os.path.exists(STATE) else {'posted': []}
        if slug in posted['posted']:
            print(f'{slug}: already posted, nothing to do')
            return

    img_bytes = None
    if img:
        try:
            with urllib.request.urlopen(img, timeout=60) as r:
                img_bytes = r.read()
        except Exception as e:
            print(f'image download failed ({e}); posting without image')
            img = None

    report, x_ok_or_absent, fb_ok = [], False, False

    xc = tuple(os.environ.get(k, '') for k in
               ('X_API_KEY', 'X_API_SECRET', 'X_ACCESS_TOKEN', 'X_ACCESS_SECRET'))
    if all(xc):
        try:
            tid = x_post(truncate_x(title, para, url), img_bytes, xc)
            report.append(f'X: OK (tweet {tid})'); x_ok_or_absent = True
        except Exception as e:
            report.append(f'X: FAIL {e}')
    else:
        report.append('X: SKIP (no secrets)'); x_ok_or_absent = True

    pid, ptok = os.environ.get('META_PAGE_ID', ''), os.environ.get('META_PAGE_TOKEN', '')
    long_text = f'{title}\n\n{para}\n{url}'
    if pid and ptok:
        try:
            report.append(f"Facebook: OK (post {fb_post(long_text, img, pid, ptok)})"); fb_ok = True
        except Exception as e:
            report.append(f'Facebook: FAIL {e}')
        igid = os.environ.get('META_IG_USER_ID', '')
        if igid and img:
            try:
                report.append(f"Instagram: OK (media {ig_post(long_text, img, igid, ptok)})")
            except Exception as e:
                report.append(f'Instagram: FAIL {e}')
        else:
            report.append('Instagram: SKIP (no ig user id or no image)')
    else:
        report.append('Facebook: SKIP (no secrets) | Instagram: SKIP')

    print('\n'.join(report))

    if slug and (x_ok_or_absent or fb_ok):
        posted = json.load(open(STATE)) if os.path.exists(STATE) else {'posted': []}
        if slug not in posted['posted']:
            posted['posted'].append(slug)
            json.dump(posted, open(STATE, 'w'))
            print(f'state: marked {slug} as posted')

if __name__ == '__main__':
    main()
