export interface CellSite {
  id: string;
  cellName: string;
  longitude: number;
  latitude: number;
  pci: number | null;
  stationName: string;
  azimuth: number | null;
  height: number | null;
  gnodeBId: string;
  band: string;
  aauModel: string;
  vendor: string;
  cgi: string;
  extra: Record<string, string | number>;
}
