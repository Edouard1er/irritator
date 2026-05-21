#!/usr/bin/env julia

# Premier generateur experimental Irritator -> Julia -> Irritator.
#
# Installation de la dependance JSON.jl si necessaire :
#   julia -e 'import Pkg; Pkg.add("JSON")'
#
# Utilisation :
#   julia generate_experiment_plan.jl input_request.json output_plan.json
#
# Sans argument, le script utilise :
#   experiment_request.json
#   experiment_plan.json

using Random
using JSON

function as_int(value, field_name::AbstractString)
    if value isa Integer
        return Int(value)
    elseif value isa Real && isinteger(value)
        return Int(value)
    end

    error("Champ entier invalide: $(field_name)")
end

function as_float(value, field_name::AbstractString)
    if value isa Real
        return Float64(value)
    end

    error("Champ numerique invalide: $(field_name)")
end

function required(data, key::AbstractString)
    if !haskey(data, key)
        error("Champ manquant dans la requete: $(key)")
    end

    return data[key]
end

function normalize_number_map(data, field_name::AbstractString)
    if data === nothing
        return Dict{String, Float64}()
    elseif data isa AbstractDict
        return Dict(string(k) => as_float(v, "$(field_name).$(k)")
                    for (k, v) in data)
    elseif data isa AbstractVector
        result = Dict{String, Float64}()

        for item in data
            name = string(required(item, "name"))
            result[name] = as_float(required(item, "value"),
                                    "$(field_name).$(name)")
        end

        return result
    end

    error("Format invalide pour $(field_name)")
end

function normalize_variable_parameters(data)
    if data === nothing
        return Vector{Dict{String, Any}}()
    elseif data isa AbstractDict
        result = Vector{Dict{String, Any}}()

        for name in sort(collect(keys(data)))
            item = data[name]
            push!(result, Dict{String, Any}(
                "name" => string(name),
                "distribution" => string(get(item, "distribution", "uniform")),
                "min" => as_float(required(item, "min"),
                                  "variable_parameters.$(name).min"),
                "max" => as_float(required(item, "max"),
                                  "variable_parameters.$(name).max"),
            ))
        end

        return result
    elseif data isa AbstractVector
        result = Vector{Dict{String, Any}}()

        for item in data
            name = string(required(item, "name"))
            push!(result, Dict{String, Any}(
                "name" => name,
                "distribution" => string(get(item, "distribution", "uniform")),
                "min" => as_float(required(item, "min"),
                                  "variable_parameters.$(name).min"),
                "max" => as_float(required(item, "max"),
                                  "variable_parameters.$(name).max"),
            ))
        end

        return result
    end

    error("Format invalide pour variable_parameters")
end

function normalize_string_vector(data, field_name::AbstractString)
    if data === nothing
        return String[]
    elseif data isa AbstractVector
        return [string(value) for value in data]
    end

    error("Format invalide pour $(field_name)")
end

function uniform_value(rng::AbstractRNG, min_value::Float64, max_value::Float64)
    return min_value + rand(rng) * (max_value - min_value)
end

function generate_random_uniform(rng::AbstractRNG,
                                 variable_parameters,
                                 number_of_simulations::Int)
    values = Vector{Dict{String, Float64}}()

    for _ in 1:number_of_simulations
        experiment_values = Dict{String, Float64}()

        for parameter in variable_parameters
            distribution = lowercase(string(parameter["distribution"]))

            if distribution != "uniform"
                error("Distribution non supportee: $(distribution)")
            end

            experiment_values[string(parameter["name"])] =
                uniform_value(rng,
                              Float64(parameter["min"]),
                              Float64(parameter["max"]))
        end

        push!(values, experiment_values)
    end

    return values
end

function generate_latin_hypercube(rng::AbstractRNG,
                                  variable_parameters,
                                  number_of_simulations::Int)
    values = [Dict{String, Float64}() for _ in 1:number_of_simulations]

    for parameter in variable_parameters
        distribution = lowercase(string(parameter["distribution"]))

        if distribution != "uniform"
            error("Distribution non supportee: $(distribution)")
        end

        name = string(parameter["name"])
        min_value = Float64(parameter["min"])
        max_value = Float64(parameter["max"])

        # Version simple : une valeur aleatoire par strate, puis permutation.
        samples = [
            uniform_value(rng,
                          min_value + (i - 1) * (max_value - min_value) /
                                      number_of_simulations,
                          min_value + i * (max_value - min_value) /
                                      number_of_simulations)
            for i in 1:number_of_simulations
        ]

        shuffle!(rng, samples)

        for i in 1:number_of_simulations
            values[i][name] = samples[i]
        end
    end

    return values
end

function generate_variable_values(rng::AbstractRNG,
                                  variable_parameters,
                                  generation_method,
                                  number_of_simulations::Int)
    method = lowercase(string(get(generation_method, "type", "random_uniform")))

    if method == "random_uniform"
        return generate_random_uniform(rng,
                                       variable_parameters,
                                       number_of_simulations)
    elseif method == "latin_hypercube"
        return generate_latin_hypercube(rng,
                                        variable_parameters,
                                        number_of_simulations)
    end

    error("Methode de generation non supportee: $(method)")
end

function experiment_id(index::Int, count::Int)
    width = max(3, length(string(count)))
    return "e_" * lpad(string(index), width, '0')
end

function build_plan(request)
    request_id = string(required(request, "request_id"))
    model = string(required(request, "model"))
    simulation = required(request, "simulation")
    generation_method = required(request, "generation_method")

    number_of_simulations = as_int(required(simulation, "number_of_simulations"),
                                   "simulation.number_of_simulations")

    if number_of_simulations <= 0
        error("simulation.number_of_simulations doit etre strictement positif")
    end

    fixed_parameters = normalize_number_map(get(request, "fixed_parameters", nothing),
                                            "fixed_parameters")
    variable_parameters =
        normalize_variable_parameters(get(request, "variable_parameters", nothing))
    initial_states = normalize_number_map(get(request, "initial_states", nothing),
                                          "initial_states")

    seed = as_int(get(generation_method, "seed", 0), "generation_method.seed")
    rng = MersenneTwister(seed)

    generated_values = generate_variable_values(rng,
                                                variable_parameters,
                                                generation_method,
                                                number_of_simulations)

    experiments = Vector{Dict{String, Any}}()

    for i in 1:number_of_simulations
        parameters = copy(fixed_parameters)
        merge!(parameters, generated_values[i])

        push!(experiments, Dict{String, Any}(
            "id" => experiment_id(i, number_of_simulations),
            "parameters" => parameters,
            "initial_states" => copy(initial_states),
        ))
    end

    return Dict{String, Any}(
        "request_id" => request_id,
        "plan_id" => "plan_$(request_id)",
        "model" => model,
        "simulation" => Dict{String, Any}(
            "t0" => as_float(required(simulation, "t0"), "simulation.t0"),
            "horizon" => as_float(required(simulation, "horizon"),
                                  "simulation.horizon"),
            "dt" => as_float(required(simulation, "dt"), "simulation.dt"),
        ),
        "experiments" => experiments,
        "state_variables_to_record" =>
            normalize_string_vector(get(request,
                                        "state_variables_to_record",
                                        nothing),
                                    "state_variables_to_record"),
        "outputs_to_record" =>
            normalize_string_vector(get(request, "outputs_to_record", nothing),
                                    "outputs_to_record"),
    )
end

function main(args)
    input_path = length(args) >= 1 ? args[1] : "experiment_request.json"
    output_path = length(args) >= 2 ? args[2] : "experiment_plan.json"

    request = JSON.parsefile(input_path)
    plan = build_plan(request)

    output_dir = dirname(output_path)
    if !isempty(output_dir) && output_dir != "."
        mkpath(output_dir)
    end

    open(output_path, "w") do io
        JSON.print(io, plan, 2)
        println(io)
    end

    println("Experiment plan generated")
    println("  experiments: $(length(plan["experiments"]))")
    println("  model: $(plan["model"])")
    println("  method: $(request["generation_method"]["type"])")
    println("  output: $(output_path)")
end

main(ARGS)
