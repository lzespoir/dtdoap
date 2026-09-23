#!/usr/bin/awk -f
#
# 从路测 CSV 提取关键列 → TSV（lon lat time sp sr lp lr dp dr ss）
# 支持多种采集器格式：
# - 原始格式：NR PCC Serving PCI / SS-RSRP(dBm) / SS-SINR(dB)
# - NEW5g 示例：末尾存在 PCI, SS-RSRP, SS-SINR, Longitude, Latitude, Altitude, Speed

BEGIN { FS = ","; OFS = "\t" }

NR == 1 {
  for (i = 1; i <= NF; i++) {
    # 去掉 UTF-8 BOM
    gsub(/^\xef\xbb\xbf/, "", $i)

    # 通用经纬度（有的格式在末尾）
    if ($i == "Longitude") c_lon = i
    else if ($i == "Latitude") c_lat = i

    # 原始 Keysight 格式
    else if ($i == "Date & Time" || $i == "Time") c_tim = i
    else if ($i == "NR PCC Serving PCI") c_sp = i
    else if ($i == "NR PCC Serving SS-RSRP(dBm)") c_sr = i
    else if ($i == "NR Listed PCI") c_lp = i
    else if ($i == "NR Listed SS-RSRP(dBm)") c_lr = i
    else if ($i == "NR Detected PCI") c_dp = i
    else if ($i == "NR Detected SS-RSRP(dBm)") c_dr = i
    else if ($i == "NR PCC Serving SS-SINR(dB)") c_ss = i

    # NEW5g 格式（尾部存在一组 PCI, SS-RSRP, SS-SINR, Longitude, Latitude）
    # 这里用一段相对位置匹配，避免和前面其他 PCI/SS-RSRP 混淆
    if ($i == "PCI" && (i + 5) <= NF) {
      if ($(i + 3) == "SS-RSRP" && $(i + 5) == "SS-SINR") {
        c_sp = i
        c_sr = i + 3
        c_ss = i + 5
      }
    }
  }

  if (c_lon == 0 || c_lat == 0) {
    print "缺少 Longitude/Latitude 列" > "/dev/stderr"
    exit 1
  }
  next
}
{
  lon = $(c_lon)
  lat = $(c_lat)
  if (lon == "" || lat == "") next
  tim = (c_tim > 0 ? $(c_tim) : "")
  sp = (c_sp > 0 ? $(c_sp) : "")
  sr = (c_sr > 0 ? $(c_sr) : "")
  lp = (c_lp > 0 ? $(c_lp) : "")
  lr = (c_lr > 0 ? $(c_lr) : "")
  dp = (c_dp > 0 ? $(c_dp) : "")
  dr = (c_dr > 0 ? $(c_dr) : "")
  ss = (c_ss > 0 ? $(c_ss) : "")
  gsub(/\t/, " ", tim)
  gsub(/\t/, " ", lp)
  gsub(/\t/, " ", lr)
  gsub(/\t/, " ", dp)
  gsub(/\t/, " ", dr)
  print lon, lat, tim, sp, sr, lp, lr, dp, dr, ss
}
