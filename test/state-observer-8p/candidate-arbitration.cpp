// Two simultaneous commands in one explicitly closed cohort. The existing
// candidate_select is the modeled arbiter; zero_order_hold is unmodified.
#include <irritator/core.hpp>
#include <algorithm>
#include <iostream>
#include <stdexcept>

namespace {
void require(bool ok, const char* text) { if (!ok) throw std::runtime_error(text); }
void checked(irt::status s) { require(!s.has_error(), "engine error"); }
template<class A, class B>
void wire(irt::simulation& s, A& a, int ap, B& b, int bp)
{
    checked(s.connect(irt::get_model(a), ap, irt::get_model(b), bp));
}
irt::event_tag& input(irt::simulation& s, double value, double key)
{
    auto& source = s.alloc<irt::constant>();
    s.parameters[s.get_id(source)].set_constant(value, 1);
    auto& tag = s.alloc<irt::event_tag>();
    s.parameters[s.get_id(tag)].reals[0] = key;
    s.parameters[s.get_id(tag)].reals[1] = 7;
    wire(s, source, 0, tag, 0);
    return tag;
}
void run(bool reverse)
{
    irt::simulation s;
    auto& select = s.alloc<irt::candidate_select>();
    auto& hold = s.alloc<irt::zero_order_hold>();
    auto& sink = s.alloc<irt::counter>();
    wire(s, select, 0, hold, 0);
    wire(s, hold, 0, sink, 0);
    // Policy: maximum score, ties by increasing numeric candidate identity.
    // Thus action 150 wins even though 260 is numerically greater.
    for (int n = 0; n != 2; ++n) {
        const int key = reverse ? 2 - n : 1 + n;
        auto& score = input(s, 9, key);
        auto& action = input(s, key == 1 ? 150 : 260, key);
        wire(s, score, 0, select, 0);
        wire(s, action, 0, select, 1);
    }
    auto& end = input(s, 2, 0);
    wire(s, end, 0, select, 2);
    s.limits.set_bound(0, 2);
    checked(s.initialize());
    int steps = 0, selected = 0, applied = 0, max_bag = 0, max_candidates = 0;
    while (!s.current_time_expired()) {
        require(++steps < 128, "zero-time livelock");
        max_bag = std::max(max_bag, static_cast<int>(hold.x[0].size));
        max_candidates = std::max(max_candidates, static_cast<int>(select.x[1].size));
        checked(s.run());
        for (const auto port : s.active_output_ports) {
            if (port == select.y[0]) {
                ++selected;
                require(s.current_time() == 1 && s.output_ports.get(port).msg == irt::message{150, 0, 0}, "wrong arbitration");
            }
            if (port == hold.y[0]) {
                ++applied;
                require(s.current_time() == 1 && s.output_ports.get(port).msg == irt::message{150, 0, 0}, "wrong actuator command");
            }
        }
    }
    require(max_candidates == 2, "competing actions did not reach the same arbitration bag");
    require(selected == 1 && applied == 1 && max_bag == 1, "physical action was not unique per bag");
    checked(s.finalize());
    std::cout << "reverse=" << reverse << "; competing actions=150,260; policy=score then smallest key"
              << "; selected=150; selection outputs=" << selected << "; actuator outputs=" << applied
              << "; maximum candidate input bag=" << max_candidates
              << "; maximum actuator input bag=" << max_bag << '\n';
}
}
int main()
{
    try { run(false); run(true); return 0; }
    catch (const std::exception& e) { std::cerr << e.what() << '\n'; return 1; }
}
