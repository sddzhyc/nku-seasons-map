export interface BasemapConfig {
  name: string;
  urls: string[];
  attribution: string;
  maxNativeZoom: number;
  subdomains: string;
}

export function basemapConfig(tiandituKey = ""): BasemapConfig {
  const key = tiandituKey.trim();
  if (key) {
    const url = (layer: string) =>
      `https://t{s}.tianditu.gov.cn/${layer}_w/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=${layer}&STYLE=default&TILEMATRIXSET=w&FORMAT=tiles&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&tk=${encodeURIComponent(key)}`;
    return {
      name: "天地图",
      urls: [url("vec"), url("cva")],
      attribution:
        '底图 © <a href="https://www.tianditu.gov.cn/" target="_blank" rel="noopener noreferrer">天地图</a>',
      maxNativeZoom: 18,
      subdomains: "01234567",
    };
  }
  return {
    name: "街道底图",
    urls: [
      "https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}",
    ],
    attribution:
      '底图 © <a href="https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer" target="_blank" rel="noopener noreferrer">Esri 及数据提供者</a>',
    maxNativeZoom: 19,
    subdomains: "",
  };
}
