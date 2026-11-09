// Inspect the production compiler and real native children before JSON/HTTP.
#define main json_runner_entrypoint
#include "main.cpp"
#undef main
#include <fstream>
#include <iomanip>

int main(int argc, char** argv) {
    try {
        irt_web::require(argc == 2, "Expected dynamic-plan fixture");
        std::ifstream file(argv[1]); const std::string input((std::istreambuf_iterator<char>(file)), {});
        D doc, catalog; doc.Parse(input.c_str()); catalog.Parse(catalog_json); configure_debug_diagnostics();
        json_wrappers graph(doc, catalog); graph.build();
        auto& s = graph.parent->project->sim; const auto& ids = graph.parent->models;
        s.limits.set_bound(doc["simulation"]["start"].GetDouble(), doc["simulation"]["end"].GetDouble());
        irt_web::checked(s.srcs.prepare(), "prepare"); irt_web::checked(s.initialize(), "initialize"); graph.audit_initialized();
        irt_web::require(graph.bindings.size() == 1, "One wrapper required by proof");
        auto& w = irt::get_dyn<irt::simulation_wrapper>(s.models.get(graph.bindings[0].wrapper));
        auto& resource = s.sims.get(graph.bindings[0].resource);
        const auto& desc = graph.descriptors.at(graph.occurrences[0].component);
        const bool linear = ids.contains("plant/X");
        const auto base = desc.spec.factors.size() + desc.spec.selections.size();
        std::map<int, unsigned> read, ready, executed, applied;
        std::map<int, std::array<double, 2>> observations;
        std::map<int, int> count;
        std::vector<std::array<double, 2>> actions;
        unsigned bag = 0; std::cout << std::setprecision(17);
        const auto near = [](double a, double b, double tol = 1e-9) { irt_web::require(std::isfinite(a) && std::abs(a-b) <= tol, "Native value mismatch"); };
        while (!s.current_time_expired()) {
            irt_web::require(++bag < 20000, "Dynamic plan livelock");
            irt_web::checked(s.run(), "run"); graph.collect(bag);
            if (s.current_time_expired()) break;
            const auto t = s.current_time();
            for (const auto& [path, id] : ids) if (path.starts_with("observer/") || path.starts_with("plant/observe") || path == "plant/effort" || path == "plant/hold")
                irt::dispatch(s.models.get(id), [&]<class T>(const T& d) {
                    if constexpr (irt::has_output_port<T>) for (int p = 0; p < std::ssize(d.y); ++p) {
                        if (std::find(s.active_output_ports.begin(), s.active_output_ports.end(), d.y[p]) == s.active_output_ports.end()) continue;
                        const auto m = s.output_ports.get(d.y[p]).msg;
                        std::cout << "EVENT " << bag << ' ' << t << ' ' << path << ':' << p << " [" << m[0] << ',' << m[1] << ',' << m[2] << "]\n";
                        if (p == 0 && (path == "plant/observeN" || path == "plant/observeC" || path == "plant/observe")) {
                            const int c = int(m[2]), f = path == "plant/observeC" ? 1 : 0;
                            observations[c][f] = m[0]; read[c] = bag;
                            const auto& src = s.models.get(ids.at(linear ? "plant/X" : f ? "plant/C" : "plant/N"));
                            near(m[0], irt::get_dyn<irt::qss3_integrator>(src).observation(t, t-src.tl).value);
                        }
                        if (p == 0 && (path == "plant/effort" || path == "plant/hold")) {
                            near(m[1], 0); near(m[2], 0); actions.push_back({t, m[0]});
                            if (t > 0) { applied[t == 1 ? 1 : 2] = bag; std::cout << "ACTION " << t << ' ' << m[0] << '\n'; }
                        }
                    }
                });
            for (const auto& e : graph.events) if (e.bag == bag && e.port == 2*base+2) {
                ready[int(e.value[2])] = bag; count[int(e.value[2])] = int(e.value[0]);
                std::cout << "PLAN_READY " << bag << ' ' << t << ' ' << e.value[2] << ' ' << e.value[1] << ' ' << e.value[0] << '\n';
            }
            const auto c = int(w.last_input_campaign);
            if (c && !executed.contains(c)) {
                executed[c] = bag;
                irt_web::require(count[c] == resource.embedded_sims.size(), "Actual child count differs from validated plan");
                const auto H = c == 1 ? (linear ? 2 : 20) : (linear ? 1 : 10);
                int scenario = 0;
                for (const auto child : resource.embedded_sims) {
                    const auto& cs = resource.embedded_sims.get<irt::simulation>(child);
                    near(cs.limits.end()-cs.limits.begin(), H);
                    std::cout << "CHILD " << bag << ' ' << t << ' ' << c << ' ' << scenario++ << " H=" << cs.limits.end()-cs.limits.begin();
                    for (size_t i = 0; i < desc.spec.factors.size(); ++i) {
                        const auto& f = desc.spec.factors[i]; const auto target = desc.targets.at(f.target).model;
                        const auto value = cs.parameters[target].reals[0];
                        if (i < (linear ? 1u : 2u)) { near(value, observations[c][i]); near(cs.parameters[target].reals[1], linear ? .001 : .01); }
                        std::cout << ' ' << f.id << '=' << value;
                    }
                    std::cout << '\n';
                }
            }
        }
        irt_web::checked(s.finalize(), "finalize");
        irt_web::require(executed.size() == 2 && observations.size() == 2 && applied.size() == 2, "Two complete campaigns required");
        if (!linear) near(irt::get_dyn<irt::constant>(s.models.get(ids.at("plant/q"))).value, .001);
        for (int c : {1, 2}) irt_web::require(read[c] < ready[c] && ready[c] < executed[c] && executed[c] < applied[c], "Observation < validation < run < action violated");
        irt_web::require(count[1] == 3 && (count[2] == 2 || count[2] == 1), "Dynamic cardinality did not change");
        const auto expected_actions = linear
          ? std::vector<std::array<double, 2>>{{0, 0}, {1, 1}, {3, 0}}
          : std::vector<std::array<double, 2>>{{0, 260}, {1, 150}, {3, count[2] == 1 ? 80.0 : 150.0}};
        irt_web::require(actions == expected_actions, "Native action dates or values differ from decisions");
        for (const auto& path : linear ? std::vector<std::string>{"plant/X"} : std::vector<std::string>{"plant/N", "plant/C"}) {
            const auto& m = s.models.get(ids.at(path)); const auto t = s.limits.end();
            std::cout << "FINAL " << path << ' ' << irt::get_dyn<irt::qss3_integrator>(m).observation(t, t-m.tl).value << '\n';
        }
        // Reset the SAME compiled graph, including native plan storage. A fresh
        // campaign 1 must be accepted without retaining responses or domains.
        irt_web::checked(s.srcs.prepare(), "reset prepare");
        irt_web::checked(s.initialize(), "reset initialize"); graph.audit_initialized();
        irt_web::require(w.last_input_campaign == 0 && resource.pending_responses.empty(), "Reset retained campaign state");
        unsigned reset_bags = 0;
        while (!s.current_time_expired()) {
            irt_web::require(++reset_bags < 20000, "Reset livelock"); irt_web::checked(s.run(), "reset run");
        }
        irt_web::checked(s.finalize(), "reset finalize");
        irt_web::require(w.last_input_campaign == 2 && resource.embedded_sims.size() == count[2], "Reset did not replay both plans");
        std::cout << "RESET_PASS bags=" << reset_bags << '\n';
        std::cout << "NATIVE_DYNAMIC_PLAN_PASS bags=" << bag << '\n'; return 0;
    } catch (const std::exception& e) { std::cerr << e.what() << '\n'; return 1; }
}
