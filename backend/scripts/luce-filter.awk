# 从 TSV 按 PCI 设置过滤 RSRP，输出 TSV：lon lat rsrp pci kind
BEGIN {
  FS = "\t"
  OFS = "\t"
  serving_all = (ENVIRON["LUCE_SERVING_PCI"] == "")
  neighbor_all = (ENVIRON["LUCE_NEIGHBOR_PCI"] == "")
  serving_deny_none = (ENVIRON["LUCE_SERVING_PCI_EXCLUDE"] == "")
  neighbor_deny_none = (ENVIRON["LUCE_NEIGHBOR_PCI_EXCLUDE"] == "")
  include_serving = (ENVIRON["LUCE_INCLUDE_SERVING"] == "1")
  include_neighbor = (ENVIRON["LUCE_INCLUDE_NEIGHBOR"] == "1")
  neighbor_src = ENVIRON["LUCE_NEIGHBOR_SOURCE"]
  max_out = ENVIRON["LUCE_MAX_SAMPLES"] + 0
  if (max_out <= 0) max_out = 0
  out_count = 0
  use_region = (ENVIRON["LUCE_USE_REGION"] == "1")
  center_lon = ENVIRON["LUCE_CENTER_LON"] + 0
  center_lat = ENVIRON["LUCE_CENTER_LAT"] + 0
  radius_m = ENVIRON["LUCE_RADIUS_M"] + 0
  cos_lat = cos(3.14159265 * center_lat / 180)
  m_per_deg = 111320
  radius_m2 = radius_m * radius_m

  use_grassland = (ENVIRON["LUCE_USE_GRASSLAND"] == "1")
  grass_lon_min = ENVIRON["LUCE_GRASS_LON_MIN"] + 0
  grass_lon_max = ENVIRON["LUCE_GRASS_LON_MAX"] + 0
  grass_lat_min = ENVIRON["LUCE_GRASS_LAT_MIN"] + 0
  grass_lat_max = ENVIRON["LUCE_GRASS_LAT_MAX"] + 0

  if (!serving_all) {
    n = split(ENVIRON["LUCE_SERVING_PCI"], arr, ",")
    for (i = 1; i <= n; i++) {
      gsub(/^[ \t]+|[ \t]+$/, "", arr[i])
      if (arr[i] != "") serving_allow[arr[i] + 0] = 1
    }
  }
  if (!neighbor_all) {
    n = split(ENVIRON["LUCE_NEIGHBOR_PCI"], arr, ",")
    for (i = 1; i <= n; i++) {
      gsub(/^[ \t]+|[ \t]+$/, "", arr[i])
      if (arr[i] != "") neighbor_allow[arr[i] + 0] = 1
    }
  }
  if (!serving_deny_none) {
    n = split(ENVIRON["LUCE_SERVING_PCI_EXCLUDE"], arr, ",")
    for (i = 1; i <= n; i++) {
      gsub(/^[ \t]+|[ \t]+$/, "", arr[i])
      if (arr[i] != "") serving_deny[arr[i] + 0] = 1
    }
  }
  if (!neighbor_deny_none) {
    n = split(ENVIRON["LUCE_NEIGHBOR_PCI_EXCLUDE"], arr, ",")
    for (i = 1; i <= n; i++) {
      gsub(/^[ \t]+|[ \t]+$/, "", arr[i])
      if (arr[i] != "") neighbor_deny[arr[i] + 0] = 1
    }
  }
}

function in_region(lon, lat) {
  if (use_region) {
    dx = (lon - center_lon) * m_per_deg * cos_lat
    dy = (lat - center_lat) * m_per_deg
    if ((dx * dx + dy * dy) > radius_m2) return 0
  }
  if (use_grassland) {
    if (lon < grass_lon_min || lon > grass_lon_max) return 0
    if (lat < grass_lat_min || lat > grass_lat_max) return 0
  }
  return 1
}

function pci_ok(pci, allow_all, allow_arr, deny_none, deny_arr) {
  if (pci == "" || pci == "NA") return 0
  p = pci + 0
  if (p != p) return 0
  if (!allow_all && !(p in allow_arr)) return 0
  if (!deny_none && (p in deny_arr)) return 0
  return 1
}

function emit(lon, lat, rsrp, pci, kind, sinr) {
  if (max_out > 0 && out_count >= max_out) return 0
  printf "%.9f\t%.9f\t%s\t%d\t%s\t%s\n", lon, lat, rsrp, pci, kind, sinr
  out_count++
  return 1
}

function process_neighbor(lon, lat, pci_raw, rsrp_raw) {
  if (pci_raw == "") return
  nn = split(pci_raw, pcis, ";")
  rn = split(rsrp_raw, rsrps, ";")
  lim = nn
  if (rn < lim) lim = rn
  for (i = 1; i <= lim; i++) {
    gsub(/^[ \t]+|[ \t]+$/, "", pcis[i])
    gsub(/^[ \t]+|[ \t]+$/, "", rsrps[i])
    if (pcis[i] == "" || rsrps[i] == "") continue
    pci = pcis[i] + 0
    rsrp = rsrps[i] + 0
    if (pci != pci || rsrp != rsrp) continue
    if (!pci_ok(pci, neighbor_all, neighbor_allow, neighbor_deny_none, neighbor_deny)) continue
    if (!emit(lon, lat, rsrp, pci, "neighbor", "")) return 0
  }
  return 1
}

{
  if (max_out > 0 && out_count >= max_out) next
  lon = $1 + 0
  lat = $2 + 0
  if (lon != lon || lat != lat) next
  if (!in_region(lon, lat)) next

  if (include_serving) {
    sp = $4
    sr = $5
    ss = $10
    if (sp != "" && sr != "") {
      pci = sp + 0
      rsrp = sr + 0
      if (pci == pci && rsrp == rsrp && pci_ok(pci, serving_all, serving_allow, serving_deny_none, serving_deny)) {
        if (!emit(lon, lat, rsrp, pci, "serving", ss)) next
      }
    }
  }

  if (include_neighbor && (max_out == 0 || out_count < max_out)) {
  if (neighbor_src == "listed" || neighbor_src == "both") {
    if (!process_neighbor(lon, lat, $6, $7)) next
  }
  if (neighbor_src == "detected" || neighbor_src == "both") {
    if (!process_neighbor(lon, lat, $8, $9)) next
  }
  }
}
