# BTCFX自動取引bot
## 概要
- bitFlyer Lightning FXで自動売買を行うプログラム　
- 取引ページスクレイピングでの注文
- 常にポジションを持ち、取引の量と方向を監視し急変動があったとき等にドテンする成行スキャタイプ
- 取引所から取得した各種データと損益等は逐次InfluxDBに登録
- 売買判定のための定数は別プログラムでテストを行いカラーマップで可視化し最も利益が出ている領域の定数を手動で設定する
- botの稼働状況のTwitterへの通知にも対応

## 環境
- Node.js
- InfluxDB
- Grafana
- Selenium
