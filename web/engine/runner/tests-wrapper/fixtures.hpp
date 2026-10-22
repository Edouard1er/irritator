#pragma once
#include "native_wrapper.hpp"
#include <memory>
#include <exception>

namespace wrapper_test {
using namespace irt_web;
struct fixture {
    // Projects/descriptors remain owned until all parent events are collected.
    irt::modeling modeling;
    std::unique_ptr<irt::component_access> access;
    irt::project parent;
    descriptor prospective;
    experiment_spec plan;
    std::vector<experiment_spec> occurrence_plans;
    target_table parent_targets;
    std::vector<wrapper_binding> bindings;
    std::vector<output_event> events;
    std::vector<std::vector<irt::output_port_id>> ports;
    std::size_t calls = 0;
    fixture() {
        // Own the modeling workspace outside shared_buffer publication slots.
        // Further writes to modeling.ids would copy a simulation_component's
        // project and its intrusive tree links. The runner uses component_access
        // directly too; no snapshots/copies of a live descriptor are needed.
        modeling.ids.write([&](auto& ids) {
            access = std::make_unique<irt::component_access>(std::move(ids));
        });
    }
    template<class Function> void edit(Function&& fn) {
        fn(*access);
    }
    void initialize();
    void step();
    void finish();
};
experiment_spec affine_plan(bool coupled = false, std::vector<double> values = {-1, 0, 1});
std::unique_ptr<fixture> make_affine(bool coupled = false, experiment_spec spec = {},
                                   bool atomic = false, bool build_parent = true);
std::unique_ptr<fixture> make_pair(bool reset = false);
void verify(fixture&, double terminal, double minimum, double rate);
} // namespace wrapper_test
