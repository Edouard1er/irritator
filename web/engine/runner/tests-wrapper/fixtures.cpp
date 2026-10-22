#include "fixtures.hpp"
#include <cmath>
#include <iostream>

namespace wrapper_test {
namespace {
void connect(irt::generic_component& gen, irt::child_id from, int out,
              irt::child_id to, int in)
{
    checked(gen.connect(gen.children.get(from), irt::connection::port{.model=out},
                        gen.children.get(to), irt::connection::port{.model=in}), "generic connect");
}
}

experiment_spec affine_plan(bool coupled, std::vector<double> values)
{
    const std::string prefix = coupled ? "system/" : "";
    experiment_spec ret;
    ret.factors = {{"rate", prefix + "u", std::move(values)}};
    ret.selections = {{"terminal", prefix + "X", irt::criteria_type::max_last},
                      {"minimum", prefix + "X", irt::criteria_type::min}};
    ret.primary = "terminal";
    return ret;
}

std::unique_ptr<fixture> make_affine(bool coupled, experiment_spec spec, bool atomic, bool build_parent)
{
    auto f = std::make_unique<fixture>();
    f->plan = spec.factors.empty() ? affine_plan(coupled) : std::move(spec);
    f->edit([&](auto& ids) {
        const auto system = declare_component(ids);
        auto& gen = generic(ids, system);
        const auto u = add_child(gen, irt::dynamics_type::constant, "u");
        const auto x = atomic ? u : add_child(gen, irt::dynamics_type::qss3_integrator, "X");
        gen.children.get(u).flags.set(irt::child_flags::configurable);
        gen.children.get(x).flags.set(irt::child_flags::observable);
        gen.children_parameters[u].set_constant(0, 0);
        if (!atomic) {
            gen.children_parameters[x].set_integrator(1, 0.01);
            connect(gen, u, 0, x, 0);
        }
        auto root = system;
        if (coupled) {
            const auto output = ids.components[system].get_or_add_y("state");
            checked(gen.connect_output(output, gen.children.get(x), irt::connection::port{.model=0}), "prospective output");
            root = declare_component(ids);
            auto& outer = generic(ids, root);
            const auto instance = add_child(outer, system, "system");
            const auto monitor = add_child(outer, irt::dynamics_type::counter, "monitor");
            checked(outer.connect(outer.children.get(instance), irt::connection::port{.compo=output},
                                  outer.children.get(monitor), irt::connection::port{.model=0}), "prospective coupled connection");
        }
        irt::project prospective;
        const auto targets = f->modeling.files.read([&](const auto& files, auto) {
            return build_project(prospective, ids, files, root);
        });
        prospective.sim.limits.set_bound(0, 2);
        f->prospective = make_descriptor(ids, std::move(prospective), targets, f->plan);
        if (!build_parent) return;
        const auto parent = declare_component(ids);
        auto& outer = generic(ids, parent);
        const auto run = add_child(outer, irt::dynamics_type::constant, "run");
        outer.children_parameters[run].set_constant(0, 1);
        const auto wrapper = add_wrapper(outer, "decision", f->prospective);
        connect(outer, run, 0, wrapper, 1);
        const auto outputs = static_cast<int>(f->plan.factors.size() + f->plan.selections.size());
        for (int port = 0; port < outputs; ++port) {
            const auto sink = add_child(outer, irt::dynamics_type::counter, "sink" + std::to_string(port));
            connect(outer, wrapper, port, sink, 0);
        }
        f->parent_targets = f->modeling.files.read([&](const auto& files, auto) {
            return build_project(f->parent, ids, files, parent);
        });
        const auto id = f->parent_targets.at("decision").model;
        const auto& w = irt::get_dyn<irt::simulation_wrapper>(f->parent.sim.models.get(id));
        f->ports.emplace_back(w.y.begin(), w.y.end());
        f->bindings.push_back(bind_wrapper(f->parent.sim, id, ids, f->prospective, f->plan));
        f->occurrence_plans.push_back(f->plan);
        release_unreferenced_resources(f->parent.sim);
    });
    f->parent.sim.limits.set_bound(0, 3);
    return f;
}

std::unique_ptr<fixture> make_pair(bool reset)
{
    auto f = make_affine(true, {}, false, false);
    f->bindings.clear();
    f->ports.clear();
    f->occurrence_plans = {f->plan, affine_plan(true, {-2, 2})};
    f->edit([&](auto& ids) {
        // Both occurrences expand the exact same coupled definition.
        const auto cell = declare_component(ids);
        auto& gen = generic(ids, cell);
        const auto wrapper = add_wrapper(gen, "decision", f->prospective);
        std::array<irt::port_id, 3> inputs{}, outputs{};
        for (int p = 0; p < 3; ++p) {
            inputs[p] = ids.components[cell].get_or_add_x("in" + std::to_string(p));
            outputs[p] = ids.components[cell].get_or_add_y("out" + std::to_string(p));
            checked(gen.connect_input(inputs[p], gen.children.get(wrapper), irt::connection::port{.model=p}), "cell input");
            checked(gen.connect_output(outputs[p], gen.children.get(wrapper), irt::connection::port{.model=p}), "cell output");
        }
        const auto root = declare_component(ids);
        auto& outer = generic(ids, root);
        for (int i = 0; i < 2; ++i) {
            const std::string name = i == 0 ? "left" : "right";
            const auto instance = add_child(outer, cell, name);
            const auto run = add_child(outer, irt::dynamics_type::constant, name + "Run");
            outer.children_parameters[run].set_constant(i == 0 ? 1.0 : 0.5, i == 0 ? 1.0 : 1.5);
            checked(outer.connect(outer.children.get(run), irt::connection::port{.model=0},
                                  outer.children.get(instance), irt::connection::port{.compo=inputs[1]}), "cell run");
            for (int p = 0; p < 3; ++p) {
                const auto sink = add_child(outer, irt::dynamics_type::counter, name + "Sink" + std::to_string(p));
                checked(outer.connect(outer.children.get(instance), irt::connection::port{.compo=outputs[p]},
                                      outer.children.get(sink), irt::connection::port{.model=0}), "cell result");
            }
            if (reset && i == 0) {
                for (const auto [at, value, port] : {std::array{2.25, -2., 2.}, std::array{2.5, 0., 0.}, std::array{2.75, 0., 1.}}) {
                    const auto pulse = add_child(outer, irt::dynamics_type::constant, "pulse" + std::to_string(port));
                    outer.children_parameters[pulse].set_constant(value, at);
                    checked(outer.connect(outer.children.get(pulse), irt::connection::port{.model=0},
                                          outer.children.get(instance), irt::connection::port{.compo=inputs[static_cast<int>(port)]}), "cell reset/factor pulse");
                }
            }
        }
        f->parent_targets = f->modeling.files.read([&](const auto& files, auto) {
            return build_project(f->parent, ids, files, root);
        });
        const auto left = f->parent_targets.at("left/decision").model;
        const auto right = f->parent_targets.at("right/decision").model;
        const auto& wl = irt::get_dyn<irt::simulation_wrapper>(f->parent.sim.models.get(left));
        const auto& wr = irt::get_dyn<irt::simulation_wrapper>(f->parent.sim.models.get(right));
        require(wl.sim_id == wr.sim_id, "Reproducer: project::set shares one descriptor resource");
        std::cout << "NATIVE_SHARED_RESOURCE reproduced=1\n";
        for (int i = 0; i < 2; ++i) {
            const auto model = i == 0 ? left : right;
            const auto& w = irt::get_dyn<irt::simulation_wrapper>(f->parent.sim.models.get(model));
            f->ports.push_back({w.y[0], w.y[1], w.y[2]});
            f->bindings.push_back(bind_wrapper(f->parent.sim, model, ids, f->prospective, f->occurrence_plans[i]));
        }
        release_unreferenced_resources(f->parent.sim);
        require(f->parent.sim.sims.size() == 2, "One private resource per occurrence; shared template released");
    });
    f->parent.sim.limits.set_bound(0, 4);
    return f;
}

void fixture::initialize()
{
    checked(parent.sim.srcs.prepare(), "prepare parent sources");
    checked(parent.sim.initialize(), "parent initialize");
    std::size_t i = 0;
    for (const auto& binding : bindings) {
        validate_binding(parent.sim, binding, occurrence_plans.at(i++));
        require(parent.sim.sims.get(binding.resource).embedded_sims.size() == binding.scenarios,
                "Native scenario count mismatch");
    }
    calls = 0;
    events.clear();
}
void fixture::step()
{
    require(++calls <= 1000, "Parent scheduler budget exceeded");
    checked(parent.sim.run(), "parent run");
    collect_outputs(parent.sim, bindings, calls, events);
    parent.sim.tick_resamplers();
}
void fixture::finish()
{
    while (!parent.sim.current_time_expired()) step();
    checked(parent.sim.finalize(), "parent finalize");
}

void verify(fixture& f, double terminal, double minimum, double rate)
{
    const std::array expected{terminal, minimum, rate};
    require(f.events.size() == 3, "Exactly three emitted events");
    const auto id = f.bindings.front().wrapper;
    const auto& wrapper = irt::get_dyn<irt::simulation_wrapper>(f.parent.sim.models.get(id));
    require(wrapper.x.size() == 3 && wrapper.y.size() == 3, "Exactly 3 input and output ports");
    for (int port = 0; port < 3; ++port) {
        const auto& event = f.events[port];
        require(event.time == 1 && event.port == port && event.wrapper == id, "DEVS output date/port");
        require(std::abs(event.value[0] - expected[port]) < 1e-9 && event.value[1] == 0 && event.value[2] == 0,
                "Actual output triplet differs from analytic oracle");
        require(wrapper.y[port] == f.ports.front()[port], "Connected output port preserved by binding");
        const auto& sink = irt::get_dyn<irt::counter>(f.parent.sim.models.get(f.parent_targets.at("sink" + std::to_string(port)).model));
        require(sink.event_number == 1 && std::abs(sink.last_value - expected[port]) < 1e-9,
                "Parent counter did not receive the expected value");
        std::cout << "EVENT t=" << event.time << " port=" << port << " value=" << event.value[0]
                  << " received=" << sink.last_value << '\n';
    }
    require(f.parent.sim.current_time() == 3, "Parent continues after wrapper decision");
}
} // namespace wrapper_test
