"""Independent stdlib analytic check; never used to generate engine/UI data.

python schaefer_8o_oracle.py --csv schaefer-8o-analytic.csv
python schaefer_8o_oracle.py path/to/nominal-N-C.json --tolerance 0.1
Accepts a raw runner result or a validation artifact containing ``result``.
"""
import argparse
import csv
import json
import math
from pathlib import Path


def analytic(effort, q, t):
    alpha, beta = .35 - q * effort, .35 / 300
    d = 1 + beta * 150 * (t if alpha == 0 else math.expm1(alpha * t) / alpha)
    return {"N": 150 * math.exp(alpha * t) / d,
            "C": q * effort / beta * math.log(d)}


def main():
    parser = argparse.ArgumentParser(__doc__)
    parser.add_argument("result", nargs="?", type=Path)
    parser.add_argument("--csv", type=Path)
    parser.add_argument("--tolerance", type=float, default=.1)
    args = parser.parse_args()
    if args.csv:
        with args.csv.open("w", newline="", encoding="utf-8") as output:
            writer = csv.writer(output)
            writer.writerow(["scenarioId", "effort", "q", "component", "time", "value"])
            for scenario in range(6):
                effort, q = [80, 150, 260][scenario % 3], [.0008, .001][scenario // 3]
                for component in ["N", "C"]:
                    for i in range(201):
                        writer.writerow([scenario, effort, q, component, i / 10,
                                         analytic(effort, q, i / 10)[component]])
    if not args.result:
        return
    data = json.loads(args.result.read_text(encoding="utf-8-sig"))
    result = data.get("result", data)
    rows = result["scenarioTrajectories"]
    assert len(rows) == 6
    assert {r["scenarioId"] for r in rows} == set(range(6))
    summary = []
    for row in rows:
        scenario = row["scenarioId"]
        effort, q = [80, 150, 260][scenario % 3], [.0008, .001][scenario // 3]
        assert row["wrapperId"] == "prospectives" and row["campaignId"] == 1
        assert row["status"] == "completed" and row["start"] == 0
        assert row["horizonRequested"] == row["horizonApplied"] == 20
        assert row["factors"] == {"effort": effort, "capturabilite": q}
        observations = row["observations"]
        assert len(observations) in [1, 2]
        assert [o["component"] for o in observations] in [["N"], ["N", "C"]]
        for observation in observations:
            assert observation["samplingInterval"] == .1
            samples, component = observation["samples"], observation["component"]
            assert len(samples) == 201
            errors, previous = [], -math.inf
            for i, point in enumerate(samples):
                t, value = point["time"], point["value"]
                assert math.isfinite(t) and math.isfinite(value) and t > previous
                assert abs(t - i / 10) <= 1e-9
                errors.append(abs(value - analytic(effort, q, t)[component]))
                previous = t
            maximum = max(errors)
            assert maximum <= args.tolerance, (scenario, component, maximum)
            summary.append({"scenarioId": scenario, "effort": effort, "q": q,
                            "component": component, "max": maximum,
                            "mae": sum(errors) / 201,
                            "rmse": math.sqrt(sum(e * e for e in errors) / 201),
                            "nativeFinal": samples[-1]["value"],
                            "analyticFinal": analytic(effort, q, 20)[component]})
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
