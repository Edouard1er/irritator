// Exercise the very same v3 compiler as the production runner, and inspect
// native bags/children before any HTTP serialization or resampling.
#define main json_runner_entrypoint
#include "main.cpp"
#undef main
#include <fstream>
#include <iomanip>

int main(int argc, char** argv) {
    try {
        irt_web::require(argc == 2, "Expected scientific fixture path");
        std::ifstream file(argv[1]);
        const std::string input((std::istreambuf_iterator<char>(file)), {});
        D doc, catalog; doc.Parse(input.c_str()); catalog.Parse(catalog_json);
        irt_web::require(!doc.HasParseError(), "Invalid native test fixture");
        configure_debug_diagnostics();
        json_wrappers graph(doc, catalog); graph.build();
        auto& s = graph.parent->project->sim;
        const auto& ids = graph.parent->models;
        const bool composed = ids.contains("observer/request");
        const std::string decision_prefix = composed ? "observer/" : "";
        irt_web::require(s.grow_models_to(static_cast<int>(s.models.size()+2)),"Native trace taps");
        for(const auto port : {4,5}) {
            auto& sink=irt::get_model(s.alloc<irt::counter>());
            irt_web::checked(s.connect(s.models.get(ids.at(decision_prefix+"decide/choose/priority")),port,sink,0),"Native selected-row trace tap");
        }
        s.limits.set_bound(0, 5);
        irt_web::checked(s.srcs.prepare(), "Prepare");
        irt_web::checked(s.initialize(), "Initialize"); graph.audit_initialized();
        const auto near = [](double actual, double expected, double tolerance = 1e-10) {
            irt_web::require(std::isfinite(actual) && std::abs(actual-expected) <= tolerance,
              "Native value " + std::to_string(actual) + " != " + std::to_string(expected));
        };
        std::map<double, std::array<double, 2>> observed;
        std::map<double, std::array<unsigned, 2>> read_bags;
        std::map<double, unsigned> initialized, ran, applied, init_sent;
        std::map<double, unsigned> requested;
        std::map<std::string, std::map<double, irt::message>> events;
        std::vector<std::array<double, 2>> actions;
        std::vector<std::array<double, 3>> deltas;
        double changed_derivative=0;
        std::cout << std::setprecision(17);
        unsigned bag = 0;
        auto& wrapper = irt::get_dyn<irt::simulation_wrapper>(s.models.get(graph.bindings[0].wrapper));
        auto& resource = s.sims.get(graph.bindings[0].resource);
        const auto& desc = graph.descriptors.at(graph.occurrences[0].component);
        while (!s.current_time_expired()) {
            irt_web::require(++bag < 10000, "Instantaneous loop");
            irt_web::checked(s.run(), "Run"); graph.collect(bag);
            if (s.current_time_expired()) break;
            const auto t = s.current_time();
            for (const auto& [full_path, id] : ids) {
                const auto path = composed && full_path.starts_with(decision_prefix) ? full_path.substr(decision_prefix.size()) : full_path;
                const bool selected = path.starts_with("synchronize/") || path.starts_with("decide/") ||
                  (composed && path == "request") ||
                  path == "plant/observeN" || path == "plant/observeC" || path == "plant/effort" || path == "plant/modelHalieutique" || path == "forecast";
                if (!selected) continue;
                irt::dispatch(s.models.get(id), [&]<class T>(const T& d) {
                    if constexpr (irt::has_output_port<T>) for (int p=0; p<std::ssize(d.y); ++p) {
                        if (std::find(s.active_output_ports.begin(), s.active_output_ports.end(), d.y[p]) == s.active_output_ports.end()) continue;
                        const auto m = s.output_ports.get(d.y[p]).msg;
                        std::cout << "EVENT " << bag << ' ' << t << ' ' << full_path << ':' << p << " [" << m[0] << ',' << m[1] << ',' << m[2] << "]\n";
                        events[path+":"+std::to_string(p)][m[2]] = m;
                        if(composed && path=="request" && p==0) requested[m[2]]=bag;
                        if(path=="decide/deltaC" && p==0) deltas.push_back({m[0],m[1],m[2]});
                        if(path=="synchronize/initValue" && p==0) init_sent[m[2]]=bag;
                        if(path=="plant/modelHalieutique" && t==1) changed_derivative=m[0];
                        // The extended request port is transport. Keep the
                        // existing value/missing scientific assertions intact.
                        if ((path == "plant/observeN" || path == "plant/observeC") && p < 2) {
                            const auto field = path == "plant/observeN" ? 0 : 1;
                            observed[m[2]][field] = m[0]; read_bags[m[2]][field] = bag;
                            const auto& source = s.models.get(ids.at(field == 0 ? "plant/N" : "plant/C"));
                            near(m[0], irt::get_dyn<irt::qss3_integrator>(source).observation(t, t-source.tl).value);
                        }
                        if (path == "plant/effort") { actions.push_back({t,m[0]}); if (t) applied[t == 1 ? 1 : 2] = bag; }
                    }
                });
            }
            if (std::find(s.immediate_models.begin(),s.immediate_models.end(),graph.bindings[0].wrapper)!=s.immediate_models.end() && wrapper.state == irt::simulation_wrapper::run_state::initialized && !resource.input_frames.empty() && init_sent[resource.input_frames.front().campaign] && bag>init_sent[resource.input_frames.front().campaign]) {
                const auto cycle = resource.input_frames.front().campaign;
                if (!initialized.contains(cycle)) {
                    initialized[cycle] = bag;
                    irt_web::require(read_bags[cycle][0] && read_bags[cycle][1] &&
                      bag > read_bags[cycle][0] && bag > read_bags[cycle][1], "Init preceded a read");
                    size_t i=0;
                    for (const auto child : resource.embedded_sims) {
                        const auto& child_sim = resource.embedded_sims.get<irt::simulation>(child);
                        for (int field=0; field<2; ++field) {
                            const auto id = desc.targets.at(field == 0 ? "N" : "C").model;
                            near(child_sim.parameters[id].reals[0], observed[cycle][field]);
                            near(child_sim.parameters[id].reals[1], .01);
                            near(irt::get_dyn<irt::qss3_integrator>(child_sim.models.get(id)).X, observed[cycle][field]);
                            irt_web::require(&child_sim.parameters[id] != &resource.sim.parameters[id], "Child aliases prototype");
                        }
                        const auto effort=child_sim.parameters[desc.targets.at("E").model].reals[0];
                        near(effort, std::array<double,3>{80,150,260}[i]);
                        std::cout << "CHILD_INIT " << bag << ' ' << t << ' ' << cycle << ' ' << i++ << ' ' << observed[cycle][0] << ' ' << observed[cycle][1] << ' ' << effort << '\n';
                    }
                }
            }
            if (wrapper.last_input_campaign && !ran.contains(double(wrapper.last_input_campaign))) ran[double(wrapper.last_input_campaign)] = bag;
        }
        irt_web::checked(s.finalize(), "Finalize");
        irt_web::require(observed.size() == 2 && initialized.size() == 2 && ran.size() == 2, "Missing native cycles");
        irt_web::require(actions == std::vector<std::array<double,2>>{{0,260},{1,150},{3,150}}, "Applied action dates differ");
        near(changed_derivative,.35*observed[1][0]*(1-observed[1][0]/300)-.001*150*observed[1][0],.01);
        irt_web::require(changed_derivative>0 && deltas.size()==6,"Effort did not change the derivative or missing deltas");
        for (const auto cycle : {1.,2.}) {
            if(composed) irt_web::require(requested[cycle] && requested[cycle]<read_bags[cycle][0], "B* did not initiate native observation");
            irt_web::require(read_bags[cycle][0] == read_bags[cycle][1], "Observations were not simultaneous");
            irt_web::require(initialized[cycle] < ran[cycle] && ran[cycle] < applied[cycle], "Causal bag order differs");
            near(events["decide/choose/primary:3"][cycle][0], cycle == 1 ? 0 : 1);
            near(events["decide/choose/secondary:3"][cycle][0], 1);
            near(events["decide/choose/priority:4"][cycle][0], 150);
            near(events["decide/choose/priority:1"][cycle][0], 1);
            for (int scenario=0; scenario<3; ++scenario) {
                double ch=0, c0=0;
                for (const auto& e : graph.events) if (e.value[2] == cycle && e.value[1] == scenario) {
                    if(e.port==7) c0=e.value[0]; if(e.port==10) ch=e.value[0];
                }
                // Every delta emission is checked in the event stream below;
                // the raw applied C baseline is independent of parent time.
                near(c0, observed[cycle][1]); irt_web::require(ch>c0, "Historical capture mistaken for future capture");
                const auto delta=std::find_if(deltas.begin(),deltas.end(),[&](const auto& d){return d[1]==scenario && d[2]==cycle;});
                irt_web::require(delta!=deltas.end(),"Missing identified delta"); near((*delta)[0],ch-c0);
            }
        }
        near(observed[1][0],138.72355,.05); near(observed[1][1],37.47392,.05);
        near(observed[2][0],148.03433,.05); near(observed[2][1],80.55034,.05);
        irt_web::require(observed[2][0] != observed[1][0] && observed[2][1] != observed[1][1], "Second child reused old states");
        for (const auto& e : graph.events) if(e.port==6 || e.port==7) near(e.value[0], observed[e.value[2]][e.port-6]);
        for (const auto& [id, expected] : std::array<std::pair<const char*,double>,2>{{{"plant/N",155.00819},{"plant/C",126.06030}}}) {
            const auto& m=s.models.get(ids.at(id)); const auto value=irt::get_dyn<irt::qss3_integrator>(m).observation(5,5-m.tl).value;
            near(value,expected,.05); std::cout << "FINAL " << id << ' ' << value << '\n';
        }
        std::cout << "NATIVE_SCHAEFER_FEEDBACK_PASS bags=" << bag << '\n'; return 0;
    } catch (const std::exception& e) { std::cerr << e.what() << '\n'; return 1; }
}
