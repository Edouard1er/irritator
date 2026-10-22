#pragma once

#include "native_graph.hpp"
#include <irritator/helpers.hpp>

#include <array>
#include <cstddef>
#include <vector>

namespace irt_web {
// Configuration only: optimization and DEVS execution belong to libirritator.
struct factor_spec {
    std::string id, target;
    std::vector<double> values;
    int real_slot = 0;
    irt::factor_type type = irt::factor_type::fixed;
    irt::random_factor random;
};
struct selection_spec {
    std::string id, target;
    irt::criteria_type criterion = irt::criteria_type::max_last;
};
struct experiment_spec {
    std::vector<factor_spec> factors;
    std::vector<selection_spec> selections;
    std::string primary;
    irt::optimization_method method = irt::optimization_method::simple;
    irt::optimization_type direction = irt::optimization_type::maximize;
    std::vector<double> weights, epsilons;
    std::vector<irt::optimization_type> types;
    std::vector<irt::operation_type> operations;
    irt::norm_type norm = irt::norm_type::min_max;
    std::optional<std::array<irt::u64, 6>> seed;
    irt::simulation_wrapper::run_type mode = irt::simulation_wrapper::run_type::complete;
    std::size_t max_scenarios = 128;
};
bool single_type(irt::factor_type);
bool random_type(irt::factor_type);
std::size_t factor_cardinality(const factor_spec&);
void validate_random_factor(const irt::random_factor&);

std::size_t validate_experiment(const irt::project&, const target_table&,
                                const experiment_spec&);

struct descriptor {
    irt::component_id component{};
    irt::simulation_component_id simulation{};
    target_table targets;
    experiment_spec spec;
    std::size_t scenarios = 0;
};

// Transfers ownership of the prospective project into the native descriptor.
// Keep ids in a private workspace until execution and collection end.
// Do not publish/copy component_access snapshots containing these live projects.
descriptor make_descriptor(irt::component_access&, irt::project&&,
                            target_table, experiment_spec);
irt::child_id add_wrapper(irt::generic_component&, std::string_view,
                          const descriptor&);

struct copy_audit {
    std::size_t factors = 0, selections = 0;
    bool complete = false;
};
copy_audit audit_copy(const irt::embedded_simulation&, const descriptor&);

struct wrapper_binding {
    irt::model_id wrapper{};
    irt::embedded_simulation_id resource{};
    copy_audit after_set, after_copy;
    std::size_t scenarios = 0;
};

// Link every wrapper before initialize, then release_unreferenced_resources.
// Never resize ports here: project::set has already installed connections.
wrapper_binding bind_wrapper(irt::simulation&, irt::model_id,
                              const irt::component_access&, const descriptor&,
                              const experiment_spec& occurrence);
void release_unreferenced_resources(irt::simulation&);
void validate_binding(const irt::simulation&, const wrapper_binding&,
                       const experiment_spec&);

struct output_event {
    irt::model_id wrapper{};
    double time = 0;
    std::size_t port = 0, bag = 0;
    std::array<double, 3> value{};
};
// Call once immediately after a successful native run(). Expiration bags are
// ignored because active_output_ports may still contain the previous bag.
void collect_outputs(const irt::simulation&, const std::vector<wrapper_binding>&,
                      std::size_t bag, std::vector<output_event>&);
} // namespace irt_web
