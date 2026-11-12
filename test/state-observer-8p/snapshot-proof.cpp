// Actual routed messages, not manually injected or corrupted storage.
// A snapshot between routing and delta_ext must own the pending input bag.
#include <irritator/core.hpp>
#include <iostream>
#include <stdexcept>
#include <string_view>

namespace {
void require(bool value, const char* message) { if (!value) throw std::runtime_error(message); }
void checked(irt::status s) { require(!s.has_error(), "engine error"); }
template<class A, class B>
void wire(irt::simulation& s, A& a, int ap, B& b, int bp)
{
    checked(s.connect(irt::get_model(a), ap, irt::get_model(b), bp));
}
void read_at(irt::simulation& s, irt::state_observer& observer, double at, double key, double campaign)
{
    auto& source = s.alloc<irt::constant>();
    s.parameters[s.get_id(source)].set_constant(0, at);
    auto& tag = s.alloc<irt::event_tag>();
    s.parameters[s.get_id(tag)].reals[0] = key;
    s.parameters[s.get_id(tag)].reals[1] = campaign;
    wire(s, source, 0, tag, 0);
    wire(s, tag, 0, observer, 1);
}
void print(const char* label, const irt::message& m)
{
    std::cout << label << "=[" << m[0] << ',' << m[1] << ',' << m[2] << "]\n";
}
}
int main(int argc, char** argv)
{
    try {
        irt::simulation s;
        auto& observer = s.alloc<irt::state_observer>();
        const auto id = s.get_id(observer);
        auto& sink = s.alloc<irt::counter>();
        wire(s, observer, 1, sink, 0);
        read_at(s, observer, 1, 3, 7);
        read_at(s, observer, 2, 9, 11);
        s.limits.set_bound(0, 3);
        checked(s.initialize());
        int steps = 0;
        while (observer.x[1].size == 0) {
            require(++steps < 32, "first read not routed");
            checked(s.run());
        }
        const auto first = irt::get_message(s, observer.x[1])[0];
        require(first == irt::message{0, 3, 7}, "wrong first read");
        print("snapshot pending read", first);
        irt::simulation_snapshot snapshot(s);
        // Full simulation copy includes message_buffer: positive control.
        irt::simulation copy(s);
        const auto& copy_observer = irt::get_dyn<irt::state_observer>(copy.models.get(id));
        require(irt::get_message(copy, copy_observer.x[1])[0] == first, "full copy control failed");
        std::cout << "full simulation copy preserves pending bag\n";
        do {
            require(++steps < 64, "second read not routed");
            checked(s.run());
        } while (observer.x[1].size == 0 || s.current_time() < 2);
        require(irt::get_message(s, observer.x[1])[0] == irt::message{0, 9, 11}, "wrong second read");
        s = snapshot;
        // References into models may have changed on assignment.
        auto& restored = irt::get_dyn<irt::state_observer>(s.models.get(id));
        const auto actual = irt::get_message(s, restored.x[1])[0];
        print("restored pending read", actual);
        const bool exact = first == actual;
        // Observe the effect on an actual DEVS output, not just input storage.
        irt::message emitted{};
        bool found = false;
        while (!found) {
            require(++steps < 96, "restored missing reply not emitted");
            checked(s.run());
            for (const auto port : s.active_output_ports) if (port == restored.y[1]) {
                emitted = s.output_ports.get(port).msg;
                found = true;
            }
        }
        print("restored missing output", emitted);
        std::cout << "restored date=" << s.current_time() << "; expected key/campaign=3/7; exact identity=" << exact << '\n';
        if (argc > 1 && std::string_view(argv[1]) == "--require-exact")
            return exact && emitted == first && s.current_time() == 1 ? 0 : 1;
        require(!exact && actual == irt::message{0, 9, 11} && emitted == actual && s.current_time() == 1,
                "snapshot obstruction no longer reproduced; revisit report");
        std::cout << "Snapshot obstruction reproduced; state_observer remains nonconformant.\n";
        return 0;
    } catch (const std::exception& e) { std::cerr << e.what() << '\n'; return 2; }
}
