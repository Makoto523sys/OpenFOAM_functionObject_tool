# OpenFOAM Tool

OpenFOAMの辞書ファイルと `controlDict` の `functions` ブロックをブラウザ上で作成するための静的Webツール集です。

## Apps

### OpenFOAM Dictionary Builder

ルートの `index.html` から起動する、単相非圧縮流向けの基本辞書生成ツールです。

- 流れの種類、流体物性、乱流モデルの設定
- `fvSchemes` / `fvSolution` の簡易設定
- `controlDict` と境界条件の生成
- 生成ファイルのプレビューと保存

### Sampling Functions Builder

`sampling-functions/index.html` から起動する、`system/controlDict` に貼り付ける `functions { ... }` ブロック専用の独立アプリです。

対応しているfunctionObject:

- `probes`: 指定点の時系列データ取得
- `sets`: 2点間の線上サンプリング
- `surfaces`: patch面上のサンプリング
- `forces`
- `forceCoeffs`
- `wallShearStress`
- `wallHeatFlux`
- `yPlus`
- `surfaceFieldValue`
- `flowRatePatch`
- `fieldMinMax`

## Usage

このリポジトリはビルド不要です。任意のブラウザでHTMLファイルを開いて使えます。

```text
index.html
sampling-functions/index.html
```

Sampling Functions Builderの基本的な流れ:

1. 共通設定で `fields`, `writeControl`, `writeInterval` を指定します。
2. 点、線、patch面、または必要なfunctionObjectを有効化して入力します。
3. 右側のプレビューに生成された `functions { ... }` ブロックが表示されます。
4. `コピー` または `保存` で取得し、OpenFOAMケースの `system/controlDict` に貼り付けます。

## OpenFOAM Target

主に OpenFOAM.com v2412 系で確認しています。生成される構文は `foamDictionary -entry functions` で読み取り確認済みです。

## Notes

- `flowRatePatch` はOpenFOAM標準辞書に合わせ、内部的には `surfaceFieldValue` の `fields (phi); operation sum;` として生成します。
- `wallShearStress` と `wallHeatFlux` の `patches` は空欄にすると全wall patch対象として扱えます。
- 生成テキストは補助用です。実ケースで使用するpatch名、field名、密度、基準面積などは解析条件に合わせて確認してください。

## Project Structure

```text
    ├── index.html
    ├── styles.css
    └── src/
        ├── app.js
        └── generator.js
```
