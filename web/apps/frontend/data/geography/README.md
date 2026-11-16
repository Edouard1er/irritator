# Lac de Guiers : données réellement obtenues

Le fichier `lac-de-guiers.atlas.json` contient le contour hydrologique **HydroLAKES v1.0**, objet **Hylak_id 1520**, `Lake_name=Guiers`, `Country=Senegal`, `Poly_src=SWBD`. Aucun secteur de pêche ni frontière de réserve n’est livré. Les trois références CLPA sont **sans coordonnées**.

`lac-de-guiers.hydrolakes.geojson` est le sous-ensemble GeoJSON RFC 7946 directement utilisable dans un SIG, avec `sourceId` sur la feature. Ses métadonnées complètes accompagnent la même géométrie dans l’atlas.

- Producteur : auteurs HydroLAKES / HydroSHEDS, Messager et al. (2016), [doi:10.1038/ncomms13603](https://doi.org/10.1038/ncomms13603).
- [Produit et licence](https://www.hydrosheds.org/products/hydrolakes) ; [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
- [Archive originale téléchargée](https://data.hydrosheds.org/file/hydrolakes/HydroLAKES_polys_v10_shp.zip), 820 295 132 octets. SHA256 : `9ef63498569dd7ccd0b8d8852da026e009a75f42d293f00e483f3b9fcfe8e1f9`.
- Récupération et première extraction : 16 novembre 2026 UTC. Ce n’est pas la date d’observation.
- [Documentation technique](https://data.hydrosheds.org/file/technical-documentation/HydroLAKES_TechDoc_v10.pdf), pp. 4–5 et 9 : SWBD/SRTM, collecte principale **février 2000**, raster source environ 30 m ; précision finale variable après généralisation. Ce n’est pas une rive actuelle ni une précision métrique garantie.
- Source PRJ : GCS_WGS_1984, D_WGS_1984, degrés ; cible EPSG:4326, longitude puis latitude ; aucune reprojection.
- Extraction DBF par nom/pays, identifiant vérifié ; entrée zéro-indexée 1519, index SHX puis enregistrement SHP 1520. Un contour, treize trous/îles, **1 458 sommets**. Aucun sommet ni île supprimé. Anneaux inversés pour l’orientation RFC 7946 et coordonnées arrondies à sept décimales (environ un centimètre ; cela ne signifie pas une précision de mesure centimétrique).
- Emprise extraite : `[-15.971161566839726,15.834447157118575,-15.714710422091484,16.3816639539936]`. Elle vient du SHP ; aucune coordonnée de village ou de réserve saisie à la main.
- `guiers-hydrolakes-1520.original.geojson` conserve l’extrait avec les coordonnées originales et attributs source. Seul le contour est utilisé pour l’affichage ; les attributs de profondeur, volume et surface ne pilotent aucun calcul.

## Reproduire

Télécharger l’archive depuis le producteur, puis depuis `web/apps/frontend` :

```powershell
python scripts/extract-guiers-hydrolakes.py CHEMIN/HydroLAKES_polys_v10_shp.zip
npm test -- --maxWorkers=2 --reporter=dot
```

Le script Python n’utilise que la bibliothèque standard, vérifie l’empreinte complète et le CRS, conserve les coordonnées originales et génère l’atlas. La validation TypeScript vérifie également les anneaux, les auto-intersections, les trous et les limites de volume. L’archive mondiale reste dans le répertoire de travail ignoré, elle n’est pas redistribuée dans le dépôt.

## Portée et lacunes

Contour hydrologique ancien et saisonnier, **pas une limite juridique ni un droit de pêche**. La différence entre cet objet historique et d’autres superficies documentaires ne doit pas être interprétée comme une évolution mesurée. La validation de la rive actuelle par l’OLAC et les acteurs reste à faire. [La page OLAC](https://www.olac.sn/reseau-hydrographique/le-lac-de-guiers) ne fournit pas de vecteur avec licence de réutilisation ; [Géo Sénégal](https://www.geosenegal.gouv.sn/) n’a pas pu être consulté (HTTP 502 pendant la recette).

Le plan CLPA départemental fourni (octobre 2025), pp. 8 et 10, cite Mbane, Ngnith et une étude/balisage sollicités vers Témeye-Toucouleur. Il ne fournit aucune géométrie : pas de contours est/ouest, pas de réserve dessinée, pas de bouées supposées installées. Les trois PDF ne sont pas redistribués avec l’application ; leurs noms et téléphones ne sont jamais intégrés.

## Import d’un autre fond

Envelopper le GeoJSON en `GeoAtlasV1` (exemple complet : atlas joint). Déclarer explicitement EPSG:4326 et des sources `verified-dataset` avec URL producteur, licence, version, date UTC, millésime/résolution, transformations, SHA256 et attribution. Chaque feature référence une source. Importer en lecture Scientifique : examiner les différences, confirmer le remplacement, puis sauvegarder séparément. Un GeoJSON brut sans métadonnées n’est jamais promu automatiquement en donnée vérifiée. L’ancien import `TerritoryGeography` reste disponible dans l’espace séparé et ne migre pas silencieusement les modèles.
