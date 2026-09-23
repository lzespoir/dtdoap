# 输入：已按时间排序的 TSV（lon lat time ...）
# 输出：全精度 lon lat，去重交给 Node pathBuilder
BEGIN { FS = "\t" }
{
  if ($1 == "" || $2 == "") next
  lon = $1 + 0
  lat = $2 + 0
  if (lon != lon || lat != lat) next
  printf "%.9f\t%.9f\n", lon, lat
}
