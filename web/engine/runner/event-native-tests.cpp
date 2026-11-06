#include "native_graph.hpp"
#include <irritator/timeline.hpp>
#include <cmath>
#include <iostream>
#include <vector>
#ifdef _MSC_VER
#include <crtdbg.h>
#define NOMINMAX
#define WIN32_LEAN_AND_MEAN
#include <Windows.h>
#endif

using namespace irt_web;
struct emission { double time; int port; irt::message value; };
template<class A, class B> auto wire(irt::simulation& sim, A& a, int ap, B& b, int bp) { return sim.connect(irt::get_model(a), ap, irt::get_model(b), bp); }
template<class T> auto& add(irt::simulation& sim) { return sim.alloc<T>(); }
auto& constant(irt::simulation& sim, double value, double at = 0)
{
    auto& d = add<irt::constant>(sim);
    sim.parameters[sim.get_id(d)].set_constant(value, at);
    return d;
}
auto& tag(irt::simulation& sim, double value, double key, double campaign, double at = 0)
{
    auto& source = constant(sim, value, at);
    auto& d = add<irt::event_tag>(sim);
    auto& p = sim.parameters[sim.get_id(d)]; p.reals[0] = key; p.reals[1] = campaign;
    checked(wire(sim, source, 0, d, 0), "source -> tag");
    return d;
}
template<class T> std::vector<emission> execute(irt::simulation& sim, T& observed)
{
    for (int p = 0; p < T::outputs; ++p) {
        auto& sink = add<irt::counter>(sim);
        checked(wire(sim, observed, p, sink, 0), "event sink");
    }
    sim.limits.set_bound(0, 3);
    checked(sim.initialize(), "initialize");
    std::vector<emission> output;
    int calls = 0;
    while (not sim.current_time_expired()) {
        require(++calls < 10000, "zero-time livelock");
        checked(sim.run(), "run");
        if (sim.current_time_expired()) break;
        for (int p = 0; p < T::outputs; ++p)
            if (std::find(sim.active_output_ports.begin(), sim.active_output_ports.end(), observed.y[p]) != sim.active_output_ports.end())
                output.push_back({ sim.current_time(), p, sim.output_ports.get(observed.y[p]).msg });
    }
    checked(sim.finalize(), "finalize");
    return output;
}
int main()
{
#ifdef _MSC_VER
    SetErrorMode(SEM_FAILCRITICALERRORS | SEM_NOGPFAULTERRORBOX);
    (void)_set_error_mode(_OUT_TO_STDERR);
    _set_abort_behavior(0, _WRITE_ABORT_MSG | _CALL_REPORTFAULT);
#ifdef _DEBUG
    _CrtSetReportMode(_CRT_ASSERT, _CRTDBG_MODE_FILE);
    _CrtSetReportFile(_CRT_ASSERT, _CRTDBG_FILE_STDERR);
#endif
#endif
    try {
        { // Keyed memory and an unknown read identity.
            irt::simulation s;
            auto& m = add<irt::value_memory>(s);
            const auto memory_id = s.get_id(m);
            auto& a = tag(s, 42, 4, 2);
            auto& r = tag(s, 0, 4, 2, 1);
            auto& missing = tag(s, 0, 5, 2, 1);
            checked(wire(s, a, 0, m, 0), "write"); checked(wire(s, r, 0, m, 1), "read"); checked(wire(s, missing, 0, m, 1), "missing");
            const auto events = execute(s, m);
            require(events.size() == 2 && events[0].time == 1 && events[1].time == 1, "memory reply date / FIFO");
            require(std::count_if(events.begin(), events.end(), [](const auto& e) { return e.port == 0 && e.value[0] == 42 && e.value[1] == 4 && e.value[2] == 2; }) == 1, "keyed memory value");
            // Snapshots deep-copy runtime state; clearing one copy is isolated.
            irt::simulation copy(s); irt::simulation_snapshot snap(s);
            require(copy.event_states.size() == s.event_states.size(), "copy omitted event state");
            require(copy.event_states.get(memory_id) != nullptr, "copy missing keyed memory");
            for (auto& r : copy.event_states.get(memory_id)->rows) r.a = 999;
            require(s.event_states.get(memory_id)->rows.back().a == 42, "copy aliased memory rows");
            copy.event_states.data.clear(); copy = snap;
            require(copy.event_states.size() == s.event_states.size(), "snapshot omitted event state");
            const auto* restored = copy.event_states.get(memory_id);
            require(restored != nullptr, "snapshot omitted memory key");
            require(restored->rows.size() == 2, "snapshot omitted memory rows");
            require(restored->rows.back().a == 42, "snapshot changed memory rows");
            // Isolate runtime ownership from connected-graph editing: the web
            // builds a fresh graph per run and never deletes live connections.
            irt::simulation lifetime;
            auto& lone = add<irt::value_memory>(lifetime);
            const auto lone_id = lifetime.get_id(lone);
            lifetime.limits.set_bound(0, 3);
            checked(lifetime.initialize(), "lifetime initialize");
            lifetime.deallocate(lone_id);
            require(lifetime.event_states.get(lone_id) == nullptr, "deallocate retained event state");
        }
        { // Reset, write and read in one bag: the read sees the replacement.
            irt::simulation s; auto& m = add<irt::value_memory>(s);
            auto& old = constant(s, 42); auto& reset = constant(s, 0, 1);
            auto& write = constant(s, 7, 1); auto& read = constant(s, 0, 1);
            checked(wire(s, old, 0, m, 0), "old"); checked(wire(s, reset, 0, m, 2), "reset");
            checked(wire(s, write, 0, m, 0), "replacement"); checked(wire(s, read, 0, m, 1), "read");
            const auto events = execute(s, m);
            require(events.size() == 1 && events[0].time == 1 && events[0].port == 0 && events[0].value[0] == 7, "reset/write/read confluence");
        }
        { // A and B arrive at different parent times; identity must survive.
            irt::simulation s; auto& op = add<irt::event_operator>(s);
            auto& p = s.parameters[s.get_id(op)]; p.integers[0] = 4; p.integers[1] = 3;
            auto& a = tag(s, 9, 4, 7); auto& b = tag(s, 3, 4, 7, 1);
            checked(wire(s, a, 0, op, 0), "a"); checked(wire(s, b, 0, op, 1), "b");
            const auto events = execute(s, op);
            require(events.size() == 1 && events[0].time == 1 && events[0].port == 0 && events[0].value[0] == 3 && events[0].value[1] == 4 && events[0].value[2] == 7, "keyed numeric join");
        }
        { // Invalid division: explicit invalid event, then end count zero.
            irt::simulation s; auto& op = add<irt::event_operator>(s);
            s.parameters[s.get_id(op)].integers[0] = 4;
            auto& a = tag(s, 9, 4, 7); auto& end = tag(s, 1, 0, 7);
            checked(wire(s, a, 0, op, 0), "a"); checked(wire(s, end, 0, op, 3), "end");
            const auto events = execute(s, op);
            require(events.size() == 2 && events[0].port == 1 && events[1].port == 2 && events[1].value[0] == 0, "invalid division / barrier");
        }
        { // End precedes a delayed action. Selection waits and keeps the key.
            irt::simulation s; auto& pick = add<irt::candidate_select>(s);
            auto& score = tag(s, 11, 3, 2); auto& action = tag(s, 99, 3, 2, 1); auto& end = tag(s, 1, 0, 2);
            checked(wire(s, score, 0, pick, 0), "score"); checked(wire(s, action, 0, pick, 1), "action"); checked(wire(s, end, 0, pick, 2), "end");
            const auto events = execute(s, pick);
            require(events.size() == 4 && events[0].time == 1 && events[0].value[0] == 99 && events[1].value[0] == 3 && events[1].value[2] == 2, "delayed selection");
        }
        std::cout << "5 native event groups passed\n";
    } catch (const std::exception& e) { std::cerr << e.what() << '\n'; return 1; }
}
