#!/usr/bin/env julia

# Premier moteur d'analyse decisionnelle Julia pour les resultats experimentaux.
#
# Installation de la dependance JSON.jl si necessaire :
#   julia -e 'import Pkg; Pkg.add("JSON")'
#
# Utilisation :
#   julia analyze_experiment_results.jl input_results.json output_decisions.json
#
# Sans argument, le script utilise :
#   experiment_results.json
#   decision_results.json

using JSON
using Statistics

struct ExperimentResultRow
    experiment_id::String
    final_B::Float64
    cumulative_catch::Float64
end

function required(data, key::AbstractString, context::AbstractString)
    if !(data isa AbstractDict)
        error("Format invalide pour $(context): objet JSON attendu")
    end

    if !haskey(data, key)
        error("Champ manquant: $(context).$(key)")
    end

    return data[key]
end

function as_finite_float(value, field_name::AbstractString)
    if !(value isa Real)
        error("Champ numerique invalide: $(field_name)")
    end

    converted = Float64(value)

    if !isfinite(converted)
        error("Valeur non finie pour $(field_name)")
    end

    return converted
end

function as_string(value, field_name::AbstractString)
    if value === nothing
        error("Champ texte invalide: $(field_name)")
    end

    converted = string(value)

    if isempty(converted)
        error("Champ texte vide: $(field_name)")
    end

    return converted
end

function minmax_normalize(value::Float64, min_value::Float64, max_value::Float64)
    if max_value == min_value
        return 1.0
    end

    return (value - min_value) / (max_value - min_value)
end

function read_result_rows(data)
    results = required(data, "results", "root")

    if !(results isa AbstractVector)
        error("Champ invalide: root.results doit etre un tableau")
    end

    if isempty(results)
        error("Aucun resultat experimental a analyser")
    end

    rows = ExperimentResultRow[]

    for (index, result) in enumerate(results)
        context = "results[$(index)]"
        experiment_id = as_string(required(result, "experiment_id", context),
                                  "$(context).experiment_id")
        summary = required(result, "summary", context)

        final_B = as_finite_float(required(summary, "final_B",
                                           "$(context).summary"),
                                  "$(context).summary.final_B")
        cumulative_catch =
            as_finite_float(required(summary, "cumulative_catch",
                                     "$(context).summary"),
                            "$(context).summary.cumulative_catch")

        push!(rows, ExperimentResultRow(experiment_id, final_B,
                                        cumulative_catch))
    end

    return rows
end

function best_by(rows, selector)
    best = rows[1]
    best_value = selector(best)

    for row in rows[2:end]
        value = selector(row)

        if value > best_value
            best = row
            best_value = value
        end
    end

    return best, best_value
end

function build_ranking(rows)
    final_values = [row.final_B for row in rows]
    catch_values = [row.cumulative_catch for row in rows]

    min_final = minimum(final_values)
    max_final = maximum(final_values)
    min_catch = minimum(catch_values)
    max_catch = maximum(catch_values)

    scored = [
        Dict{String, Any}(
            "experiment_id" => row.experiment_id,
            "score" =>
                0.5 * minmax_normalize(row.final_B, min_final, max_final) +
                0.5 * minmax_normalize(row.cumulative_catch,
                                       min_catch,
                                       max_catch),
            "final_B" => row.final_B,
            "cumulative_catch" => row.cumulative_catch,
        )
        for row in rows
    ]

    sort!(scored, by = item -> item["score"], rev = true)

    for (index, item) in enumerate(scored)
        item["rank"] = index
    end

    return scored
end

function build_decision_results(data)
    rows = read_result_rows(data)

    best_final_row, best_final_value =
        best_by(rows, row -> row.final_B)
    best_catch_row, best_catch_value =
        best_by(rows, row -> row.cumulative_catch)

    final_values = [row.final_B for row in rows]
    catch_values = [row.cumulative_catch for row in rows]
    ranking = build_ranking(rows)

    request_id = string(get(data, "request_id", ""))
    plan_id = string(get(data, "plan_id", ""))

    return Dict{String, Any}(
        "request_id" => request_id,
        "plan_id" => plan_id,
        "analysis" => Dict{String, Any}(
            "experiment_count" => length(rows),
            "best_final_B" => Dict{String, Any}(
                "experiment_id" => best_final_row.experiment_id,
                "value" => best_final_value,
            ),
            "best_cumulative_catch" => Dict{String, Any}(
                "experiment_id" => best_catch_row.experiment_id,
                "value" => best_catch_value,
            ),
            "global_statistics" => Dict{String, Any}(
                "mean_final_B" => mean(final_values),
                "mean_cumulative_catch" => mean(catch_values),
                "min_final_B" => minimum(final_values),
                "max_final_B" => maximum(final_values),
            ),
        ),
        "ranking" => ranking,
    )
end

function write_json(path::AbstractString, data)
    output_dir = dirname(path)
    if !isempty(output_dir) && output_dir != "."
        mkpath(output_dir)
    end

    open(path, "w") do io
        JSON.print(io, data, 2)
        println(io)
    end
end

function print_summary(decision_results, output_path::AbstractString)
    analysis = decision_results["analysis"]
    ranking = decision_results["ranking"]
    best_score = first(ranking)

    println("Experiment analysis completed")
    println("  experiments: $(analysis["experiment_count"])")
    println("  best final_B: $(analysis["best_final_B"]["experiment_id"])")
    println("  best cumulative_catch: $(analysis["best_cumulative_catch"]["experiment_id"])")
    println("  best score: $(best_score["experiment_id"])")
    println("  output: $(output_path)")
end

function parse_arguments(args)
    if length(args) == 0
        return "experiment_results.json", "decision_results.json"
    elseif length(args) == 2
        return args[1], args[2]
    end

    error("Usage: julia analyze_experiment_results.jl input.json output.json")
end

function main(args)
    input_path, output_path = parse_arguments(args)

    if !isfile(input_path)
        error("Fichier introuvable: $(input_path)")
    end

    data = JSON.parsefile(input_path)
    decision_results = build_decision_results(data)

    write_json(output_path, decision_results)
    print_summary(decision_results, output_path)
end

try
    main(ARGS)
catch err
    println(stderr, "Experiment analysis failed")
    println(stderr, "  error: ", sprint(showerror, err))
    exit(1)
end
