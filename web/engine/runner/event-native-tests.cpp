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
template<class T> std::vector<emission> execute(irt::simulation& sim, T& observed, int observed_ports = -1)
{
    // Preserve the historical value/missing observation interface. The new
    // observer request port is wired by native preparation, not to a test sink.
    constexpr bool observer = std::is_same_v<T, irt::state_observer>;
    const auto sink_ports = observer ? 2 : static_cast<int>(std::size(observed.y));
    if (observed_ports < 0) observed_ports = sink_ports;
    for (int p = 0; p < sink_ports; ++p) {
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
        for (int p = 0; p < observed_ports; ++p)
            if (std::find(sim.active_output_ports.begin(), sim.active_output_ports.end(), observed.y[p]) != sim.active_output_ports.end())
                output.push_back({ sim.current_time(), p, sim.output_ports.get(observed.y[p]).msg });
    }
    checked(sim.finalize(), "finalize");
    return output;
}
#include "campaign-native-tests.hpp"
#include "feedback-native-tests.hpp"
#include "group-native-tests.hpp"
#include "temporal-native-tests.hpp"
int main(int argc, char** argv)
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
        if (argc == 2 && std::string_view(argv[1]) == "temporal") { temporal_native_tests(); return 0; }
        if (argc == 2 && std::string_view(argv[1]) == "group") {
            group_native_tests(); return 0;
        }
        if (argc == 2 && std::string_view(argv[1]) == "feedback-audit") {
            feedback_audit_tests();
            std::cout << "feedback observation/action audit passed\n";
            return 0;
        }
        if (argc == 2 && std::string_view(argv[1]) == "feedback-observer") {
            feedback_observer_tests();
            std::cout << "feedback native observer groups passed\n";
            return 0;
        }
        if (argc == 2 && std::string_view(argv[1]) == "heap-remove") {
            // A distinct allocator type keeps this reduced template test
            // independent of instantiations linked from the engine archive.
            struct heap_test_allocator : irt::allocator<irt::new_delete_memory_resource> {};
            irt::heap<heap_test_allocator> h;
            require(h.reserve(512), "heap reserve");
            const auto root = h.alloc(0, static_cast<irt::model_id>(1));
            const auto leaf = h.alloc(1, static_cast<irt::model_id>(2));
            std::cerr << "before removing non-root leaf\n";
            h.remove(leaf);
            require(h.size() == 1 && h.top() == root, "leaf removal changed root");
            h.destroy(leaf);
            // More leaf removals and ordered pops.
            const auto branch = h.alloc(2, static_cast<irt::model_id>(3));
            h.alloc(3, static_cast<irt::model_id>(4));
            h.alloc(4, static_cast<irt::model_id>(5));
            h.decrease(1, branch);
            h.remove(branch); h.destroy(branch);
            for (const double expected : {0., 3., 4.}) {
                require(h.tn(h.top()) == expected, "heap pop order");
                h.pop();
            }
            require(h.empty(), "heap retained nodes");
            irt::heap<heap_test_allocator> nested;
            require(nested.reserve(512), "nested heap reserve");
            const auto internal = nested.alloc(2, static_cast<irt::model_id>(1));
            nested.alloc(3, static_cast<irt::model_id>(2));
            nested.alloc(4, static_cast<irt::model_id>(3));
            nested.alloc(1, static_cast<irt::model_id>(4));
            nested.remove(internal); nested.destroy(internal);
            for (const double expected : {1., 3., 4.}) {
                require(nested.tn(nested.top()) == expected, "child subheap merge order");
                nested.pop();
            }
            require(nested.empty(), "nested heap retained nodes");
            std::cerr << "heap removal passed\n";
            return 0;
        }
        if (argc == 2 && (std::string_view(argv[1]) == "deallocate-connected" || std::string_view(argv[1]) == "deallocate-stages")) {
            irt::simulation s;
            auto& m = add<irt::value_memory>(s);
            const auto id = s.get_id(m);
            s.parameters[id].integers[0] = 1;
            auto& source = constant(s, 42);
            checked(wire(s, source, 0, m, 0), "connected write");
            const auto events = execute(s, m); // connected sinks, completed run
            require(events.size() == 1, "connected memory output");
            std::cerr << "before connected deallocate\n";
            if (std::string_view(argv[1]) == "deallocate-stages") {
                auto& mdl = s.models.get(id);
                s.unobserve(mdl); std::cerr << "unobserve passed\n";
                s.do_deallocate(m); std::cerr << "dynamics cleanup passed\n";
                s.sched.free(mdl); std::cerr << "scheduler cleanup passed\n";
                s.models.free(mdl); std::cerr << "model cleanup passed\n";
            } else s.deallocate(id);
            require(!s.models.exists(id) && s.event_states.get(id) == nullptr, "connected runtime retained");
            std::cerr << "after connected deallocate\n";
            return 0;
        }
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
            const auto events = execute(s, pick, 4);
            require(events.size() == 4 && events[0].time == 1 && events[0].value[0] == 99 && events[1].value[0] == 3 && events[1].value[2] == 2, "delayed selection");
        }
        { // Empty cohort is a status, not an action, unless fallback is enabled.
            for (int fallback = 0; fallback <= 1; ++fallback) {
                irt::simulation s; auto& pick = add<irt::candidate_select>(s);
                auto& p = s.parameters[s.get_id(pick)]; p.integers[2] = fallback; p.reals[0] = -7;
                auto& end = tag(s, 0, 0, 9);
                checked(wire(s, end, 0, pick, 2), "empty end");
                const auto events = execute(s, pick, 4);
                require(events.size() == (fallback ? 4u : 3u), "empty output count");
                require(std::count_if(events.begin(), events.end(), [](const auto& e) { return e.port == 0; }) == fallback, "fictitious empty action");
                require(events.back().port == 3 && events.back().value[0] == 0 && events.back().value[2] == 9, "empty status/campaign");
                require(s.event_states.get(s.get_id(pick))->barriers.empty(), "empty campaign leaked");
            }
        }
        { // Two overlapping campaigns, early ends, delayed fields, three primitives.
            irt::simulation s;
            auto& op = add<irt::event_operator>(s); auto& filter = add<irt::candidate_filter>(s); auto& pick = add<irt::candidate_select>(s);
            auto& o = s.parameters[s.get_id(op)]; o.integers[0] = 10; o.reals[1] = 140;
            s.parameters[s.get_id(filter)].integers[0] = 7;
            s.parameters[s.get_id(pick)].integers[2] = 0;
            checked(wire(s, op, 0, filter, 2), "condition"); checked(wire(s, op, 2, filter, 3), "condition end");
            checked(wire(s, filter, 0, pick, 0), "filtered score"); checked(wire(s, filter, 1, pick, 1), "filtered action"); checked(wire(s, filter, 2, pick, 2), "filtered end");
            for (int campaign = 1; campaign <= 2; ++campaign) {
                auto& end = tag(s, 1, 0, campaign);
                auto& biomass = tag(s, campaign == 1 ? 150 : 123, 4, campaign, .5);
                auto& score = tag(s, campaign == 1 ? 497 : 542, 4, campaign);
                auto& action = tag(s, campaign == 1 ? 150 : 260, 4, campaign, campaign == 1 ? 1.5 : 1);
                checked(wire(s, end, 0, op, 3), "early end"); checked(wire(s, biomass, 0, op, 0), "biomass");
                checked(wire(s, score, 0, filter, 0), "score"); checked(wire(s, action, 0, filter, 1), "delayed action");
            }
            const auto events = execute(s, pick, 4);
            require(events.size() == 7, "overlapping cohort outputs");
            require(events[0].port == 1 && events[0].time == 1 && events[0].value[0] == -1 && events[0].value[2] == 2, "empty second campaign");
            require(events[2].port == 3 && events[2].value[0] == 0, "empty status");
            require(events[3].port == 0 && events[3].time == 1.5 && events[3].value[0] == 150, "late action");
            require(events[4].port == 1 && events[4].value[0] == 4 && events[4].value[2] == 1, "identity joined across campaigns");
            require(s.event_states.get(s.get_id(pick))->rows.empty(), "selection rows retained");
            require(s.event_states.get(s.get_id(filter))->rows.empty(), "filter rows retained");
            require(s.event_states.get(s.get_id(op))->rows.empty(), "operator rows retained");
        }
        campaign_native_tests();
        std::cout << "7 historical + 10 campaign native groups passed\n";
    } catch (const std::exception& e) { std::cerr << e.what() << '\n'; return 1; }
}
