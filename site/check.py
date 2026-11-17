"""Check rendered documentation, or its public deployment, using only stdlib."""
import argparse
from concurrent.futures import ThreadPoolExecutor
from html.parser import HTMLParser
import json
from pathlib import Path
import re
from urllib.error import HTTPError
from urllib.parse import unquote, urljoin, urlsplit
from urllib.request import Request, urlopen
from urllib.robotparser import RobotFileParser
from xml.etree import ElementTree

SOURCE = Path(__file__).resolve().parent
OUTPUT = SOURCE / 'dist'
PROJECT = json.loads((SOURCE / 'project.json').read_text(encoding='utf-8'))
BASE = urlsplit(PROJECT['siteUrl'])


class Page(HTMLParser):
    def __init__(self, html):
        super().__init__(convert_charrefs=True)
        self.links = []
        self.ids = set()
        self.alternates = {}
        self.meta = {}
        self.h1 = 0
        self.script = None
        self.graphs = []
        self.text = []
        self.lang = None
        self.canonical = None
        self.has_main = False
        self.feed(html)

    def handle_starttag(self, tag, attributes):
        attrs = dict(attributes)
        if tag == 'html':
            self.lang = attrs.get('lang')
        if tag == 'main':
            self.has_main = True
        if tag == 'h1':
            self.h1 += 1
        if 'id' in attrs:
            assert attrs['id'] not in self.ids, f"Duplicate ID: {attrs['id']}"
            self.ids.add(attrs['id'])
        if tag == 'script':
            assert attrs.get('type') == 'application/ld+json', 'Unexpected executable script'
            self.script = ''
        if tag == 'img':
            assert 'alt' in attrs and 'width' in attrs and 'height' in attrs, 'Image needs alt and dimensions'
        for key in ('src', 'href'):
            if key in attrs:
                self.links.append(attrs[key])
        if tag == 'meta':
            self.meta[attrs.get('name', attrs.get('property'))] = attrs.get('content', '')
        if tag == 'link':
            if attrs.get('rel') == 'canonical':
                assert self.canonical is None, 'Duplicate canonical'
                self.canonical = attrs['href']
            if attrs.get('hreflang'):
                self.alternates[attrs['hreflang']] = attrs['href']

    def handle_data(self, data):
        if self.script is not None:
            self.script += data
        else:
            self.text.append(data)

    def handle_endtag(self, tag):
        if tag == 'script':
            self.graphs.append(json.loads(self.script))
            self.script = None


def file_for_url(address):
    parts = urlsplit(address)
    assert parts.scheme == BASE.scheme and parts.netloc == BASE.netloc
    assert parts.path.startswith(BASE.path), f'URL outside project base: {address}'
    relative = unquote(parts.path[len(BASE.path):])
    target = (OUTPUT / relative).resolve()
    assert target.is_relative_to(OUTPUT.resolve()), 'Path escaped output directory'
    return target / 'index.html' if parts.path.endswith('/') else target


def check_local():
    ns = {'s': 'http://www.sitemaps.org/schemas/sitemap/0.9'}
    sitemap = ElementTree.parse(OUTPUT / 'sitemap.xml')
    addresses = [item.text for item in sitemap.findall('s:url/s:loc', ns)]
    assert len(addresses) == len(set(addresses)) == 8, 'Expected eight canonical pages'
    pages = {address: Page(file_for_url(address).read_text(encoding='utf-8')) for address in addresses}
    descriptions = set()
    for address, page in pages.items():
        assert page.has_main and page.h1 == 1 and page.lang in ('en', 'zh-Hans'), address
        assert page.canonical == address, f'Canonical mismatch: {address}'
        assert set(page.alternates) == {'en', 'zh-Hans', 'x-default'}, address
        assert all(value in addresses for value in page.alternates.values()), address
        assert page.meta.get('description') and page.meta['description'] not in descriptions, address
        descriptions.add(page.meta['description'])
        assert page.meta['robots'] == 'index,follow,max-image-preview:large', address
        assert page.meta['og:url'] == address and page.meta['og:image'].startswith(PROJECT['siteUrl'])
        assert len(page.graphs) == 1
        graph = page.graphs[0]
        assert graph['@context'] == 'https://schema.org'
        entities = {entity['@type']: entity for entity in graph['@graph']}
        assert entities['SoftwareSourceCode']['codeRepository'] == PROJECT['repository']
        assert entities['SoftwareApplication']['isBasedOn'] == PROJECT['upstream']
        assert entities['SoftwareApplication']['softwareVersion'] == PROJECT['buildVersion']
        assert entities['WebPage']['url'] == address
        assert not re.search(r'aggregateRating|reviewCount|ratingValue', json.dumps(graph)), 'Unsubstantiated rating'
        for alternate in page.alternates.values():
            assert page.canonical in pages[alternate].alternates.values(), 'Non-reciprocal hreflang'
        for href in page.links:
            absolute = urljoin(address, href)
            parts = urlsplit(absolute)
            if parts.netloc != BASE.netloc:
                assert parts.scheme == 'https', f'Unexpected external URL: {absolute}'
                continue
            target = file_for_url(absolute)
            assert target.is_file(), f'Broken internal link: {absolute}'
            if parts.fragment and target.suffix == '.html':
                destination = absolute.split('#')[0]
                assert unquote(parts.fragment) in pages[destination].ids, absolute
    for lang in ('', 'zh/'):
        faq = pages[urljoin(PROJECT['siteUrl'], f'{lang}faq/')]
        assert len([item for item in faq.ids if item != 'main']) == 12, 'FAQ answers missing'
        accounts = pages[urljoin(PROJECT['siteUrl'], f'{lang}accounts/')]
        assert {p['id'] for p in PROJECT['providers']} <= accounts.ids
        assert '1.0.4' in ''.join(accounts.text)
    assert 'noindex' in Page((OUTPUT / '404.html').read_text(encoding='utf-8')).meta['robots']
    assert not (OUTPUT / 'robots.txt').exists(), 'A subdirectory robots.txt would not control this origin'
    assert (OUTPUT / '.nojekyll').exists()
    assert json.loads((OUTPUT / 'project.json').read_text(encoding='utf-8')) == PROJECT
    print(f'PASS: {len(pages)} static pages, unique metadata, JSON-LD, reciprocal hreflang, internal links and 24 visible FAQ answers.')
    return addresses


def fetch(address):
    request = Request(address, headers={'User-Agent': 'CursorBYOK-DocsCheck/1.0'})
    with urlopen(request, timeout=20) as response:
        return response.status, response.headers, response.read()


def check_live(addresses):
    def inspect(address):
        status, headers, data = fetch(address)
        assert status == 200 and 'text/html' in headers.get('Content-Type', ''), address
        assert 'noindex' not in headers.get('X-Robots-Tag', '').lower(), address
        page = Page(data.decode('utf-8'))
        assert page.canonical == address and page.h1 == 1, address
        assert page.meta['robots'].startswith('index,follow'), address
        print(f'HTTP 200: {address}')
    with ThreadPoolExecutor(max_workers=4) as pool:
        list(pool.map(inspect, addresses))
    for name in ('sitemap.xml', 'project.json', 'llms.txt', 'assets/styles.css', 'assets/icon.png', 'assets/social.png', 'assets/dashboard.png'):
        status, _, _ = fetch(urljoin(PROJECT['siteUrl'], name))
        assert status == 200, name
    try:
        fetch(urljoin(PROJECT['siteUrl'], 'this-page-does-not-exist/'))
    except HTTPError as error:
        assert error.code == 404, 'Missing pages must return HTTP 404'
    else:
        raise AssertionError('A missing page incorrectly returned HTTP 200')
    robots_url = urljoin(PROJECT['siteUrl'], '/robots.txt')
    robots = RobotFileParser(robots_url)
    try:
        _, _, data = fetch(robots_url)
        robots.parse(data.decode('utf-8').splitlines())
    except HTTPError as error:
        assert error.code in (404, 410), f'Unexpected robots status: {error.code}'
        robots.parse([])
    for agent in ('Googlebot', 'bingbot', 'OAI-SearchBot'):
        assert all(robots.can_fetch(agent, address) for address in addresses), f'{agent} blocked by origin robots.txt'
    print('PASS: deployed pages/assets, real 404 and origin robots rules permit Googlebot, bingbot and OAI-SearchBot.')


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--live', action='store_true')
    args = parser.parse_args()
    addresses = check_local()
    if args.live:
        check_live(addresses)
