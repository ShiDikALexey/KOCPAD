/** Inline stroke icons. One place to keep the icon language consistent. */

export type IconName =
  | 'file'
  | 'folder'
  | 'folderOpen'
  | 'chevron'
  | 'plus'
  | 'folderPlus'
  | 'refresh'
  | 'close'
  | 'search'
  | 'command'
  | 'sun'
  | 'moon'
  | 'monitor'
  | 'pencil'
  | 'split'
  | 'eye'
  | 'download'
  | 'printer'
  | 'sidebar'
  | 'dots'
  | 'save'
  | 'trash'
  | 'external';

const PATHS: Record<IconName, string> = {
  file: 'M4 2.5h5.5L13 6v9.5H4z M9.5 2.5V6H13',
  folder: 'M2.5 4.5h4l1.2 1.6h6.8v7.4h-12z',
  folderOpen: 'M2.5 4.5h4l1.2 1.6h6.8v1.4M2.5 13.5l1.8-6h11.2l-1.8 6z',
  chevron: 'M7 5l4 4-4 4',
  plus: 'M8 3.5v9M3.5 8h9',
  folderPlus: 'M2.5 4.5h4l1.2 1.6h6.8v7.4h-12z M8 8.2v3.6M6.2 10h3.6',
  refresh: 'M13 8a5 5 0 1 1-1.6-3.7M13 3v3h-3',
  close: 'M4.5 4.5l7 7M11.5 4.5l-7 7',
  search: 'M7.2 11.4a4.2 4.2 0 1 0 0-8.4 4.2 4.2 0 0 0 0 8.4zM10.4 10.4L13.5 13.5',
  command: 'M3 3.5h10v9H3z M5.4 6.4l1.9 1.6-1.9 1.6 M8.8 10h2.4',
  sun: 'M8 5.4a2.6 2.6 0 1 0 0 5.2 2.6 2.6 0 0 0 0-5.2zM8 1.5v1.4M8 13.1v1.4M1.5 8h1.4M13.1 8h1.4M3.4 3.4l1 1M11.6 11.6l1 1M12.6 3.4l-1 1M4.4 11.6l-1 1',
  moon: 'M13 9.6A5.6 5.6 0 0 1 6.4 3 5.6 5.6 0 1 0 13 9.6z',
  monitor: 'M2.5 3.5h11v7h-11zM6 13.5h4M8 10.5v3',
  pencil: 'M11 2.5l2.5 2.5-8 8H3v-2.5z',
  split: 'M2.5 3.5h11v9h-11zM8 3.5v9',
  eye: 'M1.8 8S4.3 3.8 8 3.8 14.2 8 14.2 8 11.7 12.2 8 12.2 1.8 8 1.8 8zM8 6.2a1.8 1.8 0 1 0 0 3.6 1.8 1.8 0 0 0 0-3.6z',
  download: 'M8 3v7M5 7.2L8 10.2l3-3M3 12.5h10',
  printer: 'M4.5 6V2.5h7V6M4.5 11.5h-2V6.5h11v5h-2M11.5 11.5h-7v2.5h7z',
  sidebar: 'M2.5 3.5h11v9h-11zM6.5 3.5v9',
  dots: 'M4 8h.01M8 8h.01M12 8h.01',
  save: 'M3 3h8l2 2v8H3zM5.5 3v4h5V3M5.5 13v-4h5v4',
  trash: 'M3 4.5h10M6 4.5V3h4v1.5M4.5 4.5l.6 9h5.8l.6-9M6.8 7v4M9.2 7v4',
  external: 'M9.5 2.5H13v3.5M13 2.5L7.5 8M12 9.5v3.5H3V4h3.5',
};

/** Builds an SVG icon element sized to the current font. */
export function icon(name: IconName, size = 15, className = 'icon'): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.35');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', className);
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', PATHS[name]);
  svg.appendChild(path);
  return svg;
}
