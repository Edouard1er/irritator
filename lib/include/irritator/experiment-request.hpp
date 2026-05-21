// Copyright (c) 2024 INRA Distributed under the Boost Software License,
// Version 1.0. (See accompanying file LICENSE_1_0.txt or copy at
// http://www.boost.org/LICENSE_1_0.txt)

#ifndef ORG_VLEPROJECT_IRRITATOR_EXPERIMENT_REQUEST_2024
#define ORG_VLEPROJECT_IRRITATOR_EXPERIMENT_REQUEST_2024

#include <irritator/error.hpp>

#include <cstdint>
#include <filesystem>
#include <string>
#include <vector>

namespace irt {

//! Reglages temporels et volumetriques demandes au generateur externe.
struct simulation_settings {
    double t0                    = 0.0;
    double horizon               = 0.0;
    double dt                    = 0.0;
    int    number_of_simulations = 0;
};

//! Parametre fixe transmis tel quel a Julia.
struct fixed_parameter {
    std::string name;
    double      value = 0.0;
};

//! Parametre variable dont Julia doit generer les valeurs.
struct variable_parameter {
    std::string name;
    std::string distribution;
    double      min = 0.0;
    double      max = 0.0;
};

//! Etat initial attendu par le modele cible.
struct initial_state {
    std::string name;
    double      value = 0.0;
};

//! Methode de generation demandee a Julia.
struct generation_method {
    std::string   type;
    std::uint64_t seed = 0u;
};

//! Requete Irritator -> Julia pour generer un plan d'experience.
struct experiment_request {
    std::string request_id;
    std::string model_name;

    simulation_settings simulation;

    std::vector<fixed_parameter>   fixed_parameters;
    std::vector<variable_parameter> variable_parameters;
    std::vector<initial_state>      initial_states;

    std::vector<std::string> state_variables_to_record;
    std::vector<std::string> outputs_to_record;

    generation_method generation;
};

[[nodiscard]] bool is_valid(const experiment_request& request) noexcept;

[[nodiscard]] std::string validation_report(const experiment_request& request);

status write_experiment_request_json(
  const std::filesystem::path& path,
  const experiment_request&    request) noexcept;

} // namespace irt

#endif
